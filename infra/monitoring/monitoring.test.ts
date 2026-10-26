import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findJqDir, runWithStubs, writeStub } from "../../config/shellStubs";
import { requestLog } from "../../src/server/middleware/requestLog";
import { createClientReportsRoute } from "../../src/server/routes/clientReports";
import type { AppEnv } from "../../src/server/types";

interface LogMetric {
  description: string;
  filter: string;
  metricDescriptor?: { labels?: { key: string }[] };
  labelExtractors?: Record<string, string>;
}

interface AlertPolicy {
  displayName: string;
  conditions: {
    conditionThreshold: {
      filter: string;
      aggregations: { alignmentPeriod: string }[];
      comparison: string;
      duration: string;
      evaluationMissingData?: string;
    };
  }[];
  documentation: { content: string };
  notificationChannels?: string[];
}

const readJson = <T>(relative: string): T =>
  JSON.parse(fs.readFileSync(path.join(__dirname, relative), "utf-8")) as T;

const jsonFiles = (dir: "metrics" | "policies"): string[] =>
  fs
    .readdirSync(path.join(__dirname, dir))
    .filter((file) => file.endsWith(".json"))
    .sort();

const metricNames = jsonFiles("metrics").map((file) =>
  path.basename(file, ".json"),
);
const policyFiles = jsonFiles("policies");
const policies = policyFiles.map((file) =>
  readJson<AlertPolicy>(`policies/${file}`),
);
const thresholds = policies.flatMap((policy) =>
  policy.conditions.map(({ conditionThreshold }) => conditionThreshold),
);
const seconds = (duration: string): number => Number.parseInt(duration, 10);

describe("로그 기반 지표 정의", () => {
  it.each(metricNames)(
    "%s는 설명과 필터를 갖고 라벨 추출기가 선언한 라벨과 맞다",
    (name) => {
      const metric = readJson<LogMetric>(`metrics/${name}.json`);

      expect(name).toMatch(/^bst_[a-z0-9_]+$/);
      expect(metric.description).not.toBe("");
      expect(metric.filter).toContain('resource.type="cloud_run_revision"');
      expect(Object.keys(metric.labelExtractors ?? {}).sort()).toEqual(
        (metric.metricDescriptor?.labels ?? []).map(({ key }) => key).sort(),
      );
    },
  );
});

describe("알림 정책 정의", () => {
  const filters = thresholds.map(({ filter }) => filter);

  it("정책 이름은 겹치지 않고 알림 채널은 적용 스크립트가 붙인다", () => {
    const names = policies.map(({ displayName }) => displayName);

    expect(new Set(names).size).toBe(names.length);
    expect(
      policies.filter((policy) => policy.notificationChannels !== undefined),
    ).toEqual([]);
  });

  it("로그 기반 지표를 쓰는 조건은 있는 지표만 가리키고 지표는 모두 쓰인다", () => {
    const used = filters.flatMap((filter) =>
      [...filter.matchAll(/logging\.googleapis\.com\/user\/(\w+)/g)].map(
        (match) => match[1],
      ),
    );

    expect([...new Set(used)].sort()).toEqual(metricNames);
  });

  it("바꿔 넣는 자리표시자는 적용 스크립트가 채우는 것만 쓴다", () => {
    const script = fs.readFileSync(path.join(__dirname, "apply.sh"), "utf-8");
    const placeholders = [
      ...new Set(JSON.stringify(policies).match(/__[A-Z_]+__/g)),
    ].sort();

    expect(placeholders).toEqual(["__CHECK_ID__", "__SERVICE__"]);
    for (const placeholder of placeholders) {
      expect(script).toContain(placeholder);
    }
  });

  it("데이터가 끊길 때의 평가 방식은 지속 시간이 60초 이상인 조건에만 지정한다", () => {
    const withMissingDataControl = thresholds.filter(
      ({ evaluationMissingData }) => evaluationMissingData !== undefined,
    );

    expect(withMissingDataControl.length).toBeGreaterThan(0);
    expect(
      withMissingDataControl.filter(({ duration }) => seconds(duration) < 60),
    ).toEqual([]);
  });

  it("임계값 비교는 API가 받는 초과와 미만뿐이다", () => {
    expect(
      thresholds.filter(
        ({ comparison }) =>
          comparison !== "COMPARISON_GT" && comparison !== "COMPARISON_LT",
      ),
    ).toEqual([]);
  });

  it("지속 시간은 분 단위이고 정렬 주기는 60초 이상이다", () => {
    expect(
      thresholds.filter(({ duration }) => seconds(duration) % 60 !== 0),
    ).toEqual([]);
    expect(
      thresholds
        .flatMap(({ aggregations }) => aggregations)
        .filter(({ alignmentPeriod }) => seconds(alignmentPeriod) < 60),
    ).toEqual([]);
  });

  it("로그 기반 지표를 세는 조건은 사건 하나가 지속 시간보다 오래 임계값 위에 머문다", () => {
    const counted = thresholds.filter(({ filter }) =>
      filter.includes("logging.googleapis.com/user/"),
    );

    expect(counted.length).toBeGreaterThan(0);
    expect(
      counted.filter(({ aggregations, duration }) =>
        aggregations.some(
          ({ alignmentPeriod }) =>
            seconds(alignmentPeriod) <= seconds(duration),
        ),
      ),
    ).toEqual([]);
  });

  it("모든 정책이 알림을 받은 사람이 할 일을 문서로 갖는다", () => {
    expect(
      policies.filter(({ documentation }) => documentation.content === ""),
    ).toEqual([]);
  });
});

describe("지표 필터와 앱이 실제로 남기는 로그", () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    for (const method of ["log", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((line?: unknown) => {
        lines.push(String(line));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const entries = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  function matchesPayload(filter: string, entry: Record<string, unknown>) {
    const terms = [
      ...filter.matchAll(/jsonPayload\.(\w+)(>=|=)(?:"([^"]*)"|(\d+))/g),
    ];
    expect(terms.length).toBeGreaterThan(0);
    return terms.every(([, field, operator, text, number]) => {
      const value = entry[field];
      return operator === "="
        ? value === text
        : typeof value === "number" && value >= Number(number);
    });
  }

  it("bst_api_5xx는 요청 로그 중 5xx 줄만 센다", async () => {
    const app = new Hono<AppEnv>()
      .onError((_, c) => c.json({ error: "x" }, 500))
      .use("*", requestLog())
      .get("/ok", (c) => c.json({ ok: true }))
      .get("/boom", () => {
        throw new Error("boom");
      });
    await app.request("/ok");
    await app.request("/boom");

    const { filter } = readJson<LogMetric>("metrics/bst_api_5xx.json");
    expect(entries().map((entry) => matchesPayload(filter, entry))).toEqual([
      false,
      true,
    ]);
  });

  it("bst_client_server_error는 server_error 보고만 세고 앱 버전을 라벨로 뽑는다", async () => {
    const app = new Hono<AppEnv>().route(
      "/api/client-reports",
      createClientReportsRoute(),
    );
    const report = (kind: string) => ({
      kind,
      route: "/api/presentations/:id",
      online: true,
      swControlled: true,
    });
    const response = await app.request("/api/client-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appVersion: "abc1234",
        reports: [report("timeout"), report("server_error")],
      }),
    });
    expect(response.status).toBe(204);

    const metric = readJson<LogMetric>("metrics/bst_client_server_error.json");
    const matched = entries().filter((entry) =>
      matchesPayload(metric.filter, entry),
    );
    const field =
      /EXTRACT\(jsonPayload\.(\w+)\)/.exec(
        metric.labelExtractors?.app_version ?? "",
      )?.[1] ?? "";
    expect(matched).toHaveLength(1);
    expect(matched[0][field]).toBe("abc1234");
  });
});

describe.skipIf(!findJqDir())("적용 스크립트", () => {
  const workDirs: string[] = [];

  afterEach(() => {
    for (const dir of workDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const GCLOUD_STUB = `copy_policy() {
  for arg in "$@"; do
    case "$arg" in --policy-from-file=*) cp "\${arg#*=}" "$SEEN/policy-$(basename "\${arg#*=}")" ;; esac
  done
}
case "$*" in
  "auth print-access-token") echo test-token ;;
  "projects describe "*) echo 123456789 ;;
  "billing projects describe "*) echo billingAccounts/AAAAAA-BBBBBB-CCCCCC ;;
  "logging metrics describe "*) [ "$EXISTS" = 1 ] ;;
  "monitoring uptime create "*) [ -n "\${UPTIME_LOST-}" ] || touch "$STATE/uptime" ;;
  "monitoring uptime list-configs "*)
    if [ "$EXISTS" = 1 ] || [ -e "$STATE/uptime" ]; then echo projects/demo/uptimeCheckConfigs/check-1; fi ;;
  "monitoring policies list "*)
    if [ "$EXISTS" = 1 ]; then echo projects/demo/alertPolicies/1; fi ;;
  "monitoring policies "*)
    copy_policy "$@"
    if [ -n "\${FAIL_FIRST_POLICY-}" ] && [ ! -e "$STATE/failed" ]; then touch "$STATE/failed"; exit 1; fi ;;
  "billing budgets list "*)
    if [ "$EXISTS" = 1 ]; then echo billingAccounts/AAAAAA-BBBBBB-CCCCCC/budgets/1; fi ;;
  "services enable "*|"logging metrics "*|"billing budgets create "*) ;;
  *) echo "unexpected gcloud $*" >&2; exit 64 ;;
esac`;

  const CURL_STUB = `case "$*" in
  *"-X POST"*) echo '{"name":"projects/demo/notificationChannels/chan-1"}' ;;
  *)
    if [ "$EXISTS" = 1 ]; then
      echo '{"notificationChannels":[{"name":"projects/demo/notificationChannels/chan-1","type":"email","labels":{"email_address":"ops@example.com"}}]}'
    else
      echo '{}'
    fi ;;
esac`;

  function runApply(
    options: {
      exists?: boolean;
      failFirstPolicy?: boolean;
      env?: Record<string, string>;
    } = {},
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitoring-"));
    workDirs.push(dir);
    const state = path.join(dir, "state");
    const seen = path.join(dir, "seen");
    fs.mkdirSync(state);
    fs.mkdirSync(seen);
    writeStub(dir, "gcloud", GCLOUD_STUB);
    writeStub(dir, "curl", CURL_STUB);

    const run = runWithStubs(path.join(__dirname, "apply.sh"), dir, {
      PROJECT_ID: "demo",
      ALERT_EMAIL: "ops@example.com",
      RETRY_DELAY: "0",
      EXISTS: options.exists ? "1" : "0",
      STATE: state,
      SEEN: seen,
      ...(options.failFirstPolicy ? { FAIL_FIRST_POLICY: "1" } : {}),
      ...options.env,
    });
    const rendered = fs.readdirSync(seen).map((file) => ({
      name: file.replace(/^policy-/, ""),
      policy: JSON.parse(
        fs.readFileSync(path.join(seen, file), "utf-8"),
      ) as AlertPolicy,
    }));
    const gcloud = (prefix: string): string[] =>
      run.calls.filter((call) => call.startsWith(`gcloud ${prefix} `));
    return { ...run, rendered, gcloud };
  }

  const CHANNEL = "projects/demo/notificationChannels/chan-1";

  it("아무것도 없으면 이메일 채널, 지표, 가동 확인, 정책, 예산을 모두 만든다", () => {
    const run = runApply();

    expect(run.status).toBe(0);
    expect(run.calls).toContainEqual(
      expect.stringMatching(
        /^curl .*-X POST .*"email_address":"ops@example.com"/,
      ),
    );
    expect(run.gcloud("services enable")).toEqual([
      "gcloud services enable monitoring.googleapis.com logging.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com",
    ]);
    expect(
      run
        .gcloud("logging metrics create")
        .map((call) => call.split(" ")[4])
        .sort(),
    ).toEqual(metricNames);
    expect(run.gcloud("logging metrics update")).toEqual([]);

    const [uptime, ...otherUptime] = run.gcloud("monitoring uptime create");
    expect(otherUptime).toEqual([]);
    expect(uptime).toContain(
      "--resource-labels=host=bangsongteam.siku-labs.com,project_id=demo",
    );
    expect(uptime).toContain("--path=/api/health");

    const created = run.gcloud("monitoring policies create");
    expect(created).toHaveLength(policyFiles.length);
    for (const call of created) {
      expect(call).toContain(`--notification-channels=${CHANNEL}`);
    }
    expect(run.gcloud("monitoring policies update")).toEqual([]);

    const [budget, ...otherBudgets] = run.gcloud("billing budgets create");
    expect(otherBudgets).toEqual([]);
    for (const part of [
      "--billing-account=AAAAAA-BBBBBB-CCCCCC",
      "--budget-amount=10000KRW",
      "--calendar-period=month",
      "--filter-projects=projects/123456789",
      "--threshold-rule=percent=1.0,basis=forecasted-spend",
      `--notifications-rule-monitoring-notification-channels=${CHANNEL}`,
    ]) {
      expect(budget).toContain(part);
    }
  });

  it("정책에는 서비스 이름과 방금 만든 가동 확인 id를 채워 넣는다", () => {
    const { rendered } = runApply();

    expect(rendered.map(({ name }) => name).sort()).toEqual(policyFiles);
    for (const { name, policy } of rendered) {
      const text = JSON.stringify(policy);
      expect(text).not.toMatch(/__[A-Z_]+__/);
      expect(text).toContain(
        name === "uptime.json"
          ? 'check_id=\\"check-1\\"'
          : 'service_name=\\"bangsongteam\\"',
      );
    }
  });

  it("이미 있으면 새로 만들지 않고 정의대로 고친다", () => {
    const run = runApply({ exists: true });

    expect(run.status).toBe(0);
    expect(run.calls.join("\n")).not.toContain("-X POST");
    expect(run.gcloud("logging metrics create")).toEqual([]);
    expect(run.gcloud("logging metrics update")).toHaveLength(
      metricNames.length,
    );
    expect(run.gcloud("monitoring uptime create")).toEqual([]);
    expect(run.gcloud("monitoring policies create")).toEqual([]);
    const updated = run.gcloud("monitoring policies update");
    expect(updated).toHaveLength(policyFiles.length);
    for (const call of updated) {
      expect(call).toContain("update projects/demo/alertPolicies/1 ");
      expect(call).toContain(`--set-notification-channels=${CHANNEL}`);
    }
    expect(run.gcloud("billing budgets create")).toEqual([]);
    expect(run.stderr).toContain("예산이 이미 있습니다");
  });

  it("만든 가동 확인을 찾지 못하면 정책을 만들지 않고 멈춘다", () => {
    const run = runApply({ env: { UPTIME_LOST: "1" } });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("가동 확인을 찾지 못했습니다");
    expect(run.gcloud("monitoring policies create")).toEqual([]);
  });

  it("방금 만든 지표를 정책이 아직 못 찾아 실패하면 다시 시도한다", () => {
    const run = runApply({ failFirstPolicy: true });

    expect(run.status).toBe(0);
    expect(run.gcloud("monitoring policies create")).toHaveLength(
      policyFiles.length + 1,
    );
    expect(run.stderr).toContain("다시 시도합니다");
  });

  it.each(["PROJECT_ID", "ALERT_EMAIL"])(
    "%s가 없으면 아무것도 부르지 않고 멈춘다",
    (name) => {
      const run = runApply({ env: { [name]: "" } });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(name);
      expect(run.calls).toEqual([]);
    },
  );
});
