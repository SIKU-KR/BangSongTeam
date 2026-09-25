import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { count, eq, inArray } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type JoinShareResponse,
  type PresentationDocument,
  type ShareSettings,
} from "#shared";
import {
  createD1Client,
  decks,
  presentationItems,
  presentationMembers,
  presentations,
  user,
} from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { clearTables } from "../test/db";

const OWNER = "aaaaaaaa0000000000011";
const MEMBER = "bbbbbbbb0000000000012";
const DOC_ID = "1000000000000000000cc";
const DECK_ID = "c000000000000000000cc";

let currentUser: string | null = OWNER;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;
const app = createApp({ readSession: fakeSession });

function makeDoc(
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId: OWNER,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: "3000000000000000000cc",
        presentationId: DOC_ID,
        deckId: DECK_ID,
        order: 0,
        deck: {
          id: DECK_ID,
          userId: OWNER,
          scope: "presentation",
          presentationId: DOC_ID,
          title: "은혜로다",
          artist: "예수전도단",
          lyricsRaw: "시작됐네",
          slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
          backgroundId: null,
          style: DEFAULT_DECK_STYLE,
          visibility: "private",
          forkedFrom: null,
          forkCount: 0,
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function send(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
}

async function as<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  currentUser = userId;
  const res = await app.request(path, init, env);
  return { status: res.status, body: (await res.json()) as T };
}

async function shareAndJoin(): Promise<string> {
  const { body } = await as<ShareSettings>(
    OWNER,
    `/api/presentations/${DOC_ID}/share`,
    send("PUT", { access: "view" }),
  );
  await as(MEMBER, `/api/share/${body.token}/join`, send("POST"));
  return body.token as string;
}

describe("세트 링크 공유 라우트", () => {
  beforeEach(async () => {
    await clearTables(presentationItems, decks, presentations);
    await createD1Client(env.DB)
      .delete(user)
      .where(inArray(user.id, [OWNER, MEMBER]));
    await createD1Client(env.DB)
      .insert(user)
      .values([
        {
          id: OWNER,
          name: "인도자",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: MEMBER,
          name: "반주자",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    await as(OWNER, `/api/presentations/${DOC_ID}`, send("PUT", makeDoc()));
  });

  it("공유 설정은 소유자만 읽고 바꾼다", async () => {
    expect(
      (await as(MEMBER, `/api/presentations/${DOC_ID}/share`)).status,
    ).toBe(404);
    expect(
      (
        await as(
          MEMBER,
          `/api/presentations/${DOC_ID}/share`,
          send("PUT", { access: "view" }),
        )
      ).status,
    ).toBe(404);

    const { body } = await as<ShareSettings>(
      OWNER,
      `/api/presentations/${DOC_ID}/share`,
    );
    expect(body).toEqual({ access: "off", token: null });
  });

  it("링크로 들어오면 역할과 문서를 받고, 목록에 공유받은 세트로 나온다", async () => {
    const { body: settings } = await as<ShareSettings>(
      OWNER,
      `/api/presentations/${DOC_ID}/share`,
      send("PUT", { access: "view" }),
    );

    const joined = await as<JoinShareResponse>(
      MEMBER,
      `/api/share/${settings.token}/join`,
      send("POST"),
    );
    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe("viewer");
    expect(joined.body.document.items[0].deck.lyricsRaw).toBe("시작됐네");

    const list = await as<{ presentations: PresentationDocument[] }>(
      MEMBER,
      "/api/presentations",
    );
    expect(list.body.presentations).toHaveLength(1);
    expect(list.body.presentations[0].access).toEqual({
      ownerName: "인도자",
      memberId: MEMBER,
    });
  });

  it("없는 토큰이나 꺼진 링크는 404다", async () => {
    expect(
      (await as(MEMBER, "/api/share/nope/join", send("POST"))).status,
    ).toBe(404);

    const token = await shareAndJoin();
    await as(
      OWNER,
      `/api/presentations/${DOC_ID}/share`,
      send("PUT", { access: "off" }),
    );
    expect(
      (await as(MEMBER, `/api/share/${token}/join`, send("POST"))).status,
    ).toBe(404);
    expect((await as(MEMBER, `/api/presentations/${DOC_ID}`)).status).toBe(404);
  });

  it("공유받은 사람은 원본을 저장하지 못하고 지우지도 못한다", async () => {
    await shareAndJoin();
    expect(
      (
        await as(
          MEMBER,
          `/api/presentations/${DOC_ID}`,
          send("PUT", makeDoc({ title: "몰래" })),
        )
      ).status,
    ).toBe(403);
    expect(
      (await as(MEMBER, `/api/presentations/${DOC_ID}`, send("DELETE"))).status,
    ).toBe(404);

    const mine = await as<{ presentation: PresentationDocument }>(
      OWNER,
      `/api/presentations/${DOC_ID}`,
    );
    expect(mine.body.presentation.title).toBe("주일 1부 예배");
  });

  it("세트를 지우면 멤버 기록도 함께 지워진다 (FK cascade)", async () => {
    await shareAndJoin();
    await as(OWNER, `/api/presentations/${DOC_ID}`, send("DELETE"));

    const members = await createD1Client(env.DB)
      .select({ n: count() })
      .from(presentationMembers)
      .where(eq(presentationMembers.presentationId, DOC_ID))
      .get();
    expect(members?.n).toBe(0);
  });

  it("로그인하지 않으면 링크로 들어오지 못한다", async () => {
    const token = await shareAndJoin();
    currentUser = null;
    const res = await app.request(
      `/api/share/${token}/join`,
      send("POST"),
      env,
    );
    expect(res.status).toBe(401);
  });
});
