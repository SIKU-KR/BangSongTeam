import {
  cycleItem,
  DEFAULT_DECK_STYLE,
  DEV_USERS,
  splitLyricsIntoSlides,
  type Deck,
  type DeckStyle,
  type Folder,
  type PresentationDocument,
} from "#shared";
import { runBulk, type Db } from "../client";
import {
  backgroundsCol,
  COLLECTIONS,
  chunkIds,
  signUpQuotasCol,
  usersCol,
} from "../collections";
import {
  joinByToken,
  setLinkAccess,
  upsertDeck,
  upsertFolder,
  upsertPresentationDocument,
} from "../queries";

/** 개발용 곡 한 개 */
export interface SeedSong {
  title: string;
  artist: string;
  lyrics: string;
}

/**
 * 시드 계정의 보관함 곡. 화면을 확인하려고 이 저장소에서 지어 쓴 짧은 가사라, 실제 찬양곡의
 * 가사를 담지 않는다. 앞의 `OWNER_SONG_COUNT`곡은 `DEV_USERS[0]`, 나머지는 `DEV_USERS[1]`의 곡이다.
 */
export const SEED_SONGS: readonly SeedSong[] = [
  {
    title: "새벽을 여는 노래",
    artist: "개발용 찬양팀",
    lyrics:
      "어둠이 걷히는 이 아침에\n작은 목소리로 노래해요\n\n고요한 마음에 빛이 들어\n오늘도 걸어갈 힘을 얻어요\n\n새벽을 여는 노래\n함께 부르며 일어나요",
  },
  {
    title: "들꽃처럼",
    artist: "개발용 찬양팀",
    lyrics:
      "길가에 핀 작은 들꽃처럼\n바람에 흔들려도 웃어요\n\n돌보시는 손길 안에서\n한 송이 꽃으로 피어나요",
  },
  {
    title: "함께 걷는 길",
    artist: "시드 밴드",
    lyrics:
      "멀고 먼 길이라도 괜찮아요\n손을 잡고 함께 걸어요\n\n지친 어깨 서로 기대며\n한 걸음씩 나아가요\n\n함께 걷는 이 길 위에\n노래가 끊이지 않아요",
  },
  {
    title: "고요한 저녁",
    artist: "",
    lyrics:
      "해가 지는 언덕 위에서\n오늘을 돌아보아요\n\n감사한 일 하나 둘 세며\n고요히 쉼을 얻어요",
  },
  {
    title: "작은 등불",
    artist: "시드 밴드",
    lyrics:
      "작은 등불 하나 켜 들고\n어두운 골목을 비춰요\n\n나눌수록 밝아지는 빛\n이웃의 창가에 닿아요",
  },
  {
    title: "샘물 같은 은혜",
    artist: "개발용 찬양팀",
    lyrics:
      "메마른 땅에 샘이 솟듯\n내 마음에 기쁨이 넘쳐요\n\n날마다 새로운 아침\n감사의 노래 드려요",
  },
  {
    title: "주일 아침",
    artist: "연습용",
    lyrics:
      "종소리 울리는 주일 아침\n모두 모여 노래해요\n\n어린아이부터 어른까지\n한 목소리로 높여요",
  },
  {
    title: "바다 건너",
    artist: "연습용",
    lyrics:
      "바다 건너 먼 곳까지\n이 노래가 퍼져 가요\n\n파도 위에 실린 소망\n모든 이에게 닿아요",
  },
];

const OWNER_SONG_COUNT = 6;

/**
 * `data/backgrounds/dev/`의 이미지 배경 한 장. 미디어 객체(`key`)는 호출자가 먼저 올린다.
 * 파일 없는 문서가 있으면 편집기·송출이 깨진 배경을 그린다.
 */
export interface SeedBackground {
  key: string;
  title: string;
  description: string;
  keywords: string[];
  sizeBytes: number;
}

export interface DevSeedInput {
  backgrounds: readonly SeedBackground[];
}

export interface DevSeedSummary {
  libraryDecks: number;
  backgrounds: number;
  folders: number;
  presentations: number;
  shareToken: string | null;
}

const [OWNER, MEMBER] = DEV_USERS;
const RETIRED_LIBRARY_USER_ID = "bot-seed-official-lib";
const SEED_USER_IDS = [RETIRED_LIBRARY_USER_ID, ...DEV_USERS.map((u) => u.id)];
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

function toLibraryDeck(
  song: SeedSong,
  id: string,
  userId: string,
  now: Date,
): Deck {
  return {
    id,
    userId,
    scope: "library",
    presentationId: null,
    title: song.title,
    artist: song.artist,
    lyricsRaw: song.lyrics,
    slides: splitLyricsIntoSlides(song.lyrics),
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE },
    forkedFrom: null,
    forkedFromAuthorName: null,
    createdAt: iso(now, 30),
    updatedAt: iso(now, 30),
  };
}

/** 시드 계정이 가진 데이터를 모두 지운다. 외래키 cascade가 없어 컬렉션마다 찾아 지운다 */
async function resetSeedUsers(db: Db): Promise<void> {
  const owned = [
    COLLECTIONS.decks,
    COLLECTIONS.presentations,
    COLLECTIONS.presentationMembers,
    COLLECTIONS.folders,
    COLLECTIONS.driveTombstones,
    COLLECTIONS.sessions,
    COLLECTIONS.accounts,
  ];
  const snapshots = await Promise.all(
    chunkIds(SEED_USER_IDS).flatMap((ids) =>
      owned.map((name) => db.collection(name).where("userId", "in", ids).get()),
    ),
  );
  await runBulk(db, (writer) => [
    ...snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => writer.delete(doc.ref)),
    ),
    ...SEED_USER_IDS.map((id) => writer.delete(usersCol(db).doc(id))),
  ]);
}

async function clearSignUpQuotas(db: Db): Promise<void> {
  const snapshot = await signUpQuotasCol(db).get();
  await runBulk(db, (writer) =>
    snapshot.docs.map((doc) => writer.delete(doc.ref)),
  );
}

async function upsertBackgrounds(
  db: Db,
  items: readonly SeedBackground[],
  now: Date,
): Promise<string[]> {
  const ids = items.map((_, n) => seedId("bg", n));
  await runBulk(db, (writer) =>
    items.map((item, n) =>
      writer.set(backgroundsCol(db).doc(seedId("bg", n)), {
        id: seedId("bg", n),
        title: item.title,
        kind: "image",
        mediaKey: item.key,
        posterKey: item.key,
        durationSec: 0,
        sizeBytes: item.sizeBytes,
        license: "",
        description: item.description,
        keywords: [...new Set(item.keywords)],
        createdAt: now,
      }),
    ),
  );
  return ids;
}

async function insertUsers(db: Db, now: Date): Promise<void> {
  const users = DEV_USERS.map((dev) => ({
    id: dev.id,
    name: dev.name,
    email: dev.email,
    termsAgreedAt: dev.termsAgreed ? now : null,
  }));
  await runBulk(db, (writer) =>
    users.map((user) =>
      writer.set(usersCol(db).doc(user.id), {
        ...user,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  );
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
    overlayOpacity: 0,
    textBackdrop: {
      enabled: true,
      opacity: 60,
      paddingPercent: 20,
      radiusPercent: 15,
    },
  },
  { ...DEFAULT_DECK_STYLE, backgroundColor: "#1E3A8A", overlayOpacity: 0 },
];

/**
 * 로컬 Firestore(에뮬레이터)에 개발용 데이터를 만든다. 시드 계정(`DEV_USERS`)만 지우고 다시
 * 만들며, OAuth로 로그인해 생긴 다른 계정의 데이터는 건드리지 않는다. 예전 시드가 만든 공유
 * 라이브러리 계정과 그 곡도 함께 지운다.
 *
 * 곡·폴더·세트는 앱의 저장 쿼리(`upsertDeck`, `upsertFolder`,
 * `upsertPresentationDocument` …)로 넣어 편집기에서 만든 데이터와 같은 모양이 되게 한다.
 * id는 모두 `seedId`로 고정한다. 보관함 곡은 `SEED_SONGS`로 만들고, 프레젠테이션의 곡은 그
 * 계정의 보관함 곡을 담은 사본이다.
 *
 * 배경은 repo에 든 가벼운 이미지(`SeedBackground`)만 등록하고 곡에 입힌다. 운영 배경
 * 영상은 수 GB라 로컬 미디어 저장소에 올리지 않는다.
 *
 * 이메일 가입 하루 한도(`signUpQuotas`)도 비운다. 로컬 개발 서버는 모든 가입을 루프백 주소 하나로
 * 세어(`limitEmailSignUps`) 가입을 여러 번 시험하면 그날은 더 가입하지 못한다.
 */
export async function seedDevData(
  db: Db,
  { backgrounds: seedBackgrounds }: DevSeedInput,
  now: Date = new Date(),
): Promise<DevSeedSummary> {
  await Promise.all([resetSeedUsers(db), clearSignUpQuotas(db)]);
  await insertUsers(db, now);

  const backgroundIds = await upsertBackgrounds(db, seedBackgrounds, now);
  const backgroundAt = (n: number): string | null =>
    cycleItem(backgroundIds, n) ?? null;

  const ownerLibrary = SEED_SONGS.slice(0, OWNER_SONG_COUNT).map((song, n) => ({
    ...toLibraryDeck(song, seedId("deck", n), OWNER.id, now),
    backgroundId: backgroundAt(n),
    style: OWNER_STYLES[n % OWNER_STYLES.length] as DeckStyle,
    createdAt: iso(now, 20 - n),
    updatedAt: iso(now, 10 - n),
  }));
  const memberLibrary = SEED_SONGS.slice(OWNER_SONG_COUNT).map((song, n) =>
    toLibraryDeck(song, seedId("deck", 100 + n), MEMBER.id, now),
  );
  for (const deck of [...ownerLibrary, ...memberLibrary]) {
    await upsertDeck(db, deck.userId, deck);
  }
  const libraryOf = (userId: string): Deck[] =>
    userId === OWNER.id ? ownerLibrary : memberLibrary;

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
      songs: [5, 0, 3],
    },
    {
      n: 3,
      owner: OWNER.id,
      title: "성탄 전야 찬양제",
      serviceDate: sunday(now, 8),
      folder: null,
      songs: Array.from({ length: 12 }, (_, i) => i),
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
      songs: [1, 4],
      trashed: true,
    },
    {
      n: 6,
      owner: MEMBER.id,
      title: "찬양팀 연습",
      serviceDate: sunday(now, 0),
      folder: null,
      songs: [0, 1],
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
        const library = libraryOf(spec.owner);
        const source = library[song % library.length] as Deck;
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
            forkedFrom: source.id,
          },
        };
      }),
    };
    await upsertPresentationDocument(db, spec.owner, doc);
  }

  const share = await setLinkAccess(db, seedId("pres", 2), OWNER.id, "view");
  if (share?.token) await joinByToken(db, share.token, MEMBER.id);

  return {
    libraryDecks: ownerLibrary.length + memberLibrary.length,
    backgrounds: backgroundIds.length,
    folders: folderSpecs.length,
    presentations: presentationSpecs.length,
    shareToken: share?.token ?? null,
  };
}
