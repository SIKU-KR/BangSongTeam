import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  DEV_USERS,
  splitLyricsIntoSlides,
  type Deck,
  type DeckStyle,
  type Folder,
  type PresentationDocument,
} from "#shared";
import { backgrounds, decks, reports, user } from "../schema";
import {
  joinByToken,
  setDeckVisibility,
  setLinkAccess,
  toDeckRow,
  upsertDeck,
  upsertFolder,
  upsertPresentationDocument,
} from "../queries";
import { runStatements } from "../queries/batch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

/** `data/cleaned/*.json`의 곡 한 개 */
export interface SeedSong {
  title: string;
  artist?: string | null;
  lyrics: string;
}

export interface DevSeedSummary {
  libraryDecks: number;
  backgrounds: number;
  folders: number;
  presentations: number;
  shareToken: string | null;
}

/**
 * 공유 라이브러리 곡을 올린 계정. `scripts/seedSelected.mjs`가 운영 D1에 쓰는 봇 계정과
 * 같은 id라 로컬 라이브러리가 운영과 같은 작성자로 보인다.
 */
export const SEED_LIBRARY_USER = {
  id: "bot-seed-official-lib",
  name: "공식 찬양 라이브러리",
  email: "library@worship.local",
} as const;

const [OWNER, MEMBER] = DEV_USERS;
const SEED_USER_IDS = [SEED_LIBRARY_USER.id, ...DEV_USERS.map((u) => u.id)];
const TITLE_MAX = 100;
const ROWS_PER_INSERT = 5;
const STATEMENTS_PER_BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 시드 행의 고정 id (`seed-<kind>-000…n`, 21자).
 *
 * 다시 시드해도 같은 id가 나와야 한다. 브라우저 IndexedDB에 남은 세트·폴더는 서버에
 * 없으면 '아직 안 올라간 항목'으로 보고 다시 올리므로, id가 바뀌면 옛 시드가 되살아난다.
 */
export function seedId(kind: string, n: number): string {
  const prefix = `seed-${kind}-`;
  return prefix + String(n).padStart(21 - prefix.length, "0");
}

function iso(now: Date, daysAgo = 0): string {
  return new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
}

function sunday(now: Date, weeksFromNow: number): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  date.setUTCDate(
    date.getUTCDate() + ((7 - date.getUTCDay()) % 7) + weeksFromNow * 7,
  );
  return date.toISOString().slice(0, 10);
}

function serviceTitle(serviceDate: string, suffix: string): string {
  const [, month, day] = serviceDate.split("-").map(Number);
  return `${month}월 ${day}일 ${suffix}`;
}

function toLibraryDeck(song: SeedSong, index: number, now: Date): Deck {
  return {
    id: seedId("lib", index),
    userId: SEED_LIBRARY_USER.id,
    scope: "library",
    presentationId: null,
    title: song.title.trim().slice(0, TITLE_MAX) || "제목 없음",
    artist: (song.artist ?? "").trim().slice(0, TITLE_MAX),
    lyricsRaw: song.lyrics.trim(),
    slides: splitLyricsIntoSlides(song.lyrics),
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE },
    visibility: "public",
    forkedFrom: null,
    forkCount: 0,
    origin: "user",
    forkedFromAuthorName: null,
    publishedAt: iso(now, 30),
    takedownAt: null,
    createdAt: iso(now, 30),
    updatedAt: iso(now, 30),
  };
}

async function resetSeedUsers(db: DbInstance): Promise<void> {
  await db.delete(reports).where(inArray(reports.userId, SEED_USER_IDS));
  await db.delete(user).where(inArray(user.id, SEED_USER_IDS));
}

async function insertUsers(db: DbInstance, now: Date): Promise<void> {
  await db.insert(user).values([
    {
      ...SEED_LIBRARY_USER,
      emailVerified: true,
      termsAgreedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    ...DEV_USERS.map((dev) => ({
      id: dev.id,
      name: dev.name,
      email: dev.email,
      emailVerified: true,
      termsAgreedAt: dev.termsAgreed ? now : null,
      createdAt: now,
      updatedAt: now,
    })),
  ]);
}

async function insertLibrary(db: DbInstance, library: Deck[]): Promise<void> {
  const statements: unknown[] = [];
  for (let i = 0; i < library.length; i += ROWS_PER_INSERT) {
    statements.push(
      db
        .insert(decks)
        .values(library.slice(i, i + ROWS_PER_INSERT).map(toDeckRow)),
    );
  }
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    await runStatements(db, statements.slice(i, i + STATEMENTS_PER_BATCH));
  }
}

async function insertFork(
  db: DbInstance,
  userId: string,
  source: Deck,
  authorName: string,
  n: number,
): Promise<void> {
  await runStatements(db, [
    db.insert(decks).values(
      toDeckRow({
        ...source,
        id: seedId("fork", n),
        userId,
        visibility: "private",
        forkedFrom: source.id,
        forkedFromAuthorName: authorName,
        forkCount: 0,
        origin: "fork",
        publishedAt: null,
      }),
    ),
    db
      .update(decks)
      .set({ forkCount: sql`${decks.forkCount} + 1` })
      .where(eq(decks.id, source.id)),
  ]);
}

const OWNER_STYLES: DeckStyle[] = [
  { ...DEFAULT_DECK_STYLE },
  {
    ...DEFAULT_DECK_STYLE,
    fontFamily: "Nanum Myeongjo",
    textAlign: "left",
    overlayOpacity: 60,
    position: {
      anchor: "bottom-left",
      xPercent: 10,
      yPercent: 90,
      widthPercent: 80,
    },
  },
  {
    ...DEFAULT_DECK_STYLE,
    fontFamily: "Noto Sans KR",
    fontSizeVw: 5.5,
    fontColor: "#FDE68A",
    textShadowLevel: "strong",
  },
  { ...DEFAULT_DECK_STYLE, backgroundColor: "#1E3A8A", overlayOpacity: 0 },
];

/**
 * 로컬 D1에 개발용 데이터를 만든다. 시드 계정(`SEED_LIBRARY_USER`, `DEV_USERS`)만
 * 지우고 다시 만들며, OAuth로 로그인해 생긴 다른 계정의 데이터는 건드리지 않는다.
 *
 * 곡·폴더·세트는 앱의 저장 쿼리(`upsertDeck`, `upsertFolder`,
 * `upsertPresentationDocument` …)로 넣어 편집기에서 만든 데이터와 같은 모양이 되게 한다.
 * id는 모두 `seedId`로 고정한다. 가져온 곡은 `forkPublicDeck`이 새 id를 만들어서 같은
 * 규칙(원본 `fork_count` + 1)으로 직접 넣는다.
 * 배경은 만들지 않는다. R2 객체가 먼저 있어야 해서 `scripts/importBackgrounds.mjs`가
 * 맡고, 여기서는 이미 등록된 배경을 곡에 입히기만 한다.
 */
export async function seedDevData(
  db: DbInstance,
  songs: readonly SeedSong[],
  now: Date = new Date(),
): Promise<DevSeedSummary> {
  if (songs.length === 0) throw new Error("시드할 곡이 없습니다");

  await resetSeedUsers(db);
  await insertUsers(db, now);

  const library = songs.map((song, index) => toLibraryDeck(song, index, now));
  await insertLibrary(db, library);

  const backgroundIds: string[] = (
    await db
      .select({ id: backgrounds.id })
      .from(backgrounds)
      .orderBy(asc(backgrounds.title))
      .limit(12)
  ).map((row: { id: string }) => row.id);
  const backgroundAt = (n: number): string | null =>
    backgroundIds.length > 0 ? backgroundIds[n % backgroundIds.length] : null;
  const libraryAt = (n: number): Deck =>
    library[(n * 97) % library.length] as Deck;

  for (let n = 0; n < 6; n++) {
    await upsertDeck(db, OWNER.id, {
      ...libraryAt(n),
      id: seedId("deck", n),
      userId: OWNER.id,
      backgroundId: backgroundAt(n),
      style: OWNER_STYLES[n % OWNER_STYLES.length] as DeckStyle,
      visibility: "private",
      publishedAt: null,
      createdAt: iso(now, 20 - n),
      updatedAt: iso(now, 10 - n),
    });
  }
  const published = await setDeckVisibility(
    db,
    OWNER.id,
    seedId("deck", 0),
    "public",
  );
  await insertFork(db, OWNER.id, libraryAt(10), SEED_LIBRARY_USER.name, 0);
  await insertFork(db, OWNER.id, libraryAt(11), SEED_LIBRARY_USER.name, 1);
  if (published.status === "ok") {
    await insertFork(db, MEMBER.id, published.deck, OWNER.name, 2);
  }

  for (let n = 0; n < 2; n++) {
    await upsertDeck(db, MEMBER.id, {
      ...libraryAt(20 + n),
      id: seedId("deck", 100 + n),
      userId: MEMBER.id,
      visibility: "private",
      publishedAt: null,
    });
  }

  const folderSpecs: Array<{
    n: number;
    name: string;
    parent: number | null;
    trashed?: boolean;
  }> = [
    { n: 0, name: "주일예배", parent: null },
    { n: 1, name: "이번 달", parent: 0 },
    { n: 2, name: "청년부", parent: null },
    { n: 3, name: "지난 수련회", parent: null, trashed: true },
  ];
  for (const spec of folderSpecs) {
    const folder: Folder = {
      id: seedId("folder", spec.n),
      userId: OWNER.id,
      parentId: spec.parent === null ? null : seedId("folder", spec.parent),
      name: spec.name,
      trashedAt: spec.trashed ? iso(now, 1) : null,
      createdAt: iso(now, 40),
      updatedAt: iso(now, 40),
    };
    await upsertFolder(db, OWNER.id, folder);
  }

  let itemSeq = 0;
  const presentationSpecs: Array<{
    n: number;
    owner: string;
    title: string;
    serviceDate: string;
    folder: number | null;
    songs: number[];
    trashed?: boolean;
  }> = [
    {
      n: 0,
      owner: OWNER.id,
      title: serviceTitle(sunday(now, 0), "주일예배"),
      serviceDate: sunday(now, 0),
      folder: 1,
      songs: [0, 1, 2, 3],
    },
    {
      n: 1,
      owner: OWNER.id,
      title: serviceTitle(sunday(now, 1), "주일예배"),
      serviceDate: sunday(now, 1),
      folder: 1,
      songs: [4, 5, 6],
    },
    {
      n: 2,
      owner: OWNER.id,
      title: "청년부 금요기도회",
      serviceDate: sunday(now, 0),
      folder: 2,
      songs: [7, 8, 9],
    },
    {
      n: 3,
      owner: OWNER.id,
      title: "성탄 전야 찬양제",
      serviceDate: sunday(now, 8),
      folder: null,
      songs: Array.from({ length: 12 }, (_, i) => 30 + i),
    },
    {
      n: 4,
      owner: OWNER.id,
      title: "새 프레젠테이션",
      serviceDate: sunday(now, 2),
      folder: null,
      songs: [],
    },
    {
      n: 5,
      owner: OWNER.id,
      title: serviceTitle(sunday(now, -1), "주일예배"),
      serviceDate: sunday(now, -1),
      folder: null,
      songs: [12, 13],
      trashed: true,
    },
    {
      n: 6,
      owner: MEMBER.id,
      title: "찬양팀 연습",
      serviceDate: sunday(now, 0),
      folder: null,
      songs: [14, 15],
    },
  ];
  for (const spec of presentationSpecs) {
    const presentationId = seedId("pres", spec.n);
    const doc: PresentationDocument = {
      id: presentationId,
      userId: spec.owner,
      title: spec.title,
      serviceDate: spec.serviceDate,
      folderId: spec.folder === null ? null : seedId("folder", spec.folder),
      trashedAt: spec.trashed ? iso(now, 1) : null,
      createdAt: iso(now, 14 - spec.n),
      updatedAt: iso(now, 7 - spec.n),
      items: spec.songs.map((song, order) => {
        const source = libraryAt(song);
        const seq = itemSeq++;
        return {
          id: seedId("item", seq),
          presentationId,
          deckId: seedId("pdeck", seq),
          order,
          deck: {
            ...source,
            id: seedId("pdeck", seq),
            userId: spec.owner,
            scope: "presentation",
            presentationId,
            backgroundId: backgroundAt(seq),
            visibility: "private",
            forkedFrom: source.id,
            publishedAt: null,
          },
        };
      }),
    };
    await upsertPresentationDocument(db, spec.owner, doc);
  }

  const share = await setLinkAccess(db, seedId("pres", 2), OWNER.id, "view");
  if (share?.token) await joinByToken(db, share.token, MEMBER.id);

  return {
    libraryDecks: library.length,
    backgrounds: backgroundIds.length,
    folders: folderSpecs.length,
    presentations: presentationSpecs.length,
    shareToken: share?.token ?? null,
  };
}
