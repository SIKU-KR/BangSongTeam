/**
 * Cloud Logging이 로그 줄의 trace로 읽는 특수 필드. 같은 요청의 Cloud Run 요청 로그 아래에
 * 앱 로그가 묶여 보인다.
 * https://cloud.google.com/logging/docs/structured-logging
 */
export const CLOUD_TRACE_LOG_FIELD = "logging.googleapis.com/trace";

const METADATA_PROJECT_URL =
  "http://metadata.google.internal/computeMetadata/v1/project/project-id";
const METADATA_TIMEOUT_MS = 1_000;

let metadataProject: Promise<string | null> | undefined;

async function fetchMetadataProject(): Promise<string | null> {
  try {
    const res = await fetch(METADATA_PROJECT_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.text()).trim() || null;
  } catch {
    return null;
  }
}

async function projectId(): Promise<string | null> {
  const fromEnv = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (fromEnv) return fromEnv;
  if (!process.env.K_SERVICE) return null;
  metadataProject ??= fetchMetadataProject();
  return metadataProject;
}

/**
 * 앞단이 붙인 `x-cloud-trace-context`로 Cloud Logging trace 이름
 * (`projects/<프로젝트>/traces/<trace id>`)을 만든다. 헤더가 없거나 프로젝트를 모르면 없다.
 *
 * Cloud Run은 `GOOGLE_CLOUD_PROJECT`를 넣어 주지 않으므로, 없으면 메타데이터 서버에 한 번 묻고
 * 그 결과를 프로세스가 끝날 때까지 쓴다.
 */
export async function cloudTraceName(
  traceContext: string | undefined,
): Promise<string | undefined> {
  const traceId = traceContext?.split("/")[0];
  if (!traceId) return undefined;
  const project = await projectId();
  return project ? `projects/${project}/traces/${traceId}` : undefined;
}

export function __resetCloudTraceProjectForTests(): void {
  metadataProject = undefined;
}
