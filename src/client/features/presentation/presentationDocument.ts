import type { Deck, Presentation, PresentationItem } from "#shared";
import {
  MAX_PRESENTATION_TITLE_LENGTH,
  appendWithinLimit,
  createId,
} from "#shared";
import { COMMON_COPY } from "#copy/common";

/** 덱 깊은 복사. 덱은 JSON으로 표현되는 값만 담는다. */
export function cloneDeck(deck: Deck): Deck {
  return JSON.parse(JSON.stringify(deck)) as Deck;
}

/**
 * 한 문서 안에서 덱 id가 겹치는 곡에 새 덱 id를 준다. 덱 id가 같으면 서버의
 * `decks` 기본키를 위반해 문서가 저장되지 않는다. 처음 나온 덱은 그대로 두고 뒤에
 * 나온 덱만 바꾸며, 원래 id는 `forkedFrom`에 남긴다. `item.deckId`가 덱 id와
 * 어긋난 곡도 맞춘다. 고친 문서의 id를 `repairedIds`로 돌려준다.
 */
export function repairDuplicateDeckIds(documents: Presentation[]): {
  documents: Presentation[];
  repairedIds: string[];
} {
  const repairedIds: string[] = [];

  const repaired = documents.map((doc) => {
    const seen = new Set<string>();

    const items = doc.items.map((item) => {
      const deck = item.deck;
      if (!deck) return item;

      if (!seen.has(deck.id)) {
        seen.add(deck.id);
        if (item.deckId === deck.id) return item;
        return { ...item, deckId: deck.id };
      }

      const newId = createId();
      seen.add(newId);
      return {
        ...item,
        deckId: newId,
        deck: { ...deck, id: newId, forkedFrom: deck.forkedFrom ?? deck.id },
      };
    });

    const changed = items.some((item, index) => item !== doc.items[index]);
    if (!changed) return doc;
    repairedIds.push(doc.id);
    return { ...doc, items };
  });

  return { documents: repaired, repairedIds };
}

/**
 * 되돌리기 기록의 문서에 지금 문서의 폴더·휴지통 배치와 기준 판을 입힌다. 이동·휴지통은
 * 편집 기록을 남기지 않으므로, 되돌리기가 문서를 다른 폴더로 옮기면 안 된다.
 *
 * 기준 판은 기록할 때의 판이 아니라 지금 판이 바탕으로 삼은 서버 판이다. 기록의 옛 기준 판을
 * 실어 보내면 그사이 이 탭이 올린 판과 엇갈려 자기 수정끼리 충돌한다.
 */
export function withCurrentPlacement(
  snapshot: Presentation,
  current: Presentation,
): Presentation {
  const next: Presentation = { ...snapshot };
  delete next.folderId;
  delete next.trashedAt;
  delete next.baseUpdatedAt;
  if (current.folderId !== undefined) next.folderId = current.folderId;
  if (current.trashedAt !== undefined) next.trashedAt = current.trashedAt;
  if (current.baseUpdatedAt !== undefined) {
    next.baseUpdatedAt = current.baseUpdatedAt;
  }
  return next;
}

/**
 * 서버가 확정한 판 그대로인지: 기준 판이 있고 수정 시각이 기준 판과 같다. 올릴 것이 없다.
 *
 * 편집은 언제나 기준 판보다 늦은 시각으로 찍으므로, 서버가 확정한 뒤 고친 판은 시각이 앞선다.
 */
export function isSyncedWithServer(doc: Presentation): boolean {
  const base = doc.baseUpdatedAt;
  return (
    typeof base === "string" && Date.parse(base) === Date.parse(doc.updatedAt)
  );
}

/**
 * 서버에 올리지 않은 편집이 있다고 확실히 말할 수 있는지: 서버가 확정한 적 없는 판(기준 판
 * `null`)이거나 기준 판 뒤에 고친 판이다. 기준 판이 없는 이전 저장본은 알 수 없어 아니다.
 *
 * 다른 기기와 엇갈렸거나 다른 기기에서 영구 삭제한 세트를 지우기 전에, 이 기기의 편집을 사본으로
 * 남길지 정한다.
 */
export function hasUnsyncedEdits(doc: Presentation): boolean {
  const base = doc.baseUpdatedAt;
  if (base === null) return true;
  return (
    typeof base === "string" && Date.parse(doc.updatedAt) > Date.parse(base)
  );
}

/**
 * 덱을 이 프레젠테이션 전용 복제본으로 만든다 (Clone-on-Add). 공유 라이브러리
 * 덱은 원본 id를 `forkedFrom`에 남기고, 복제본은 언제나 비공개다.
 */
export function forkDeckIntoPresentation(
  deck: Deck,
  presentationId: string,
  userId: string,
  now: string,
): Deck {
  return {
    ...cloneDeck(deck),
    id: createId(),
    userId,
    scope: "presentation",
    presentationId,
    forkedFrom: deck.scope === "library" ? deck.id : (deck.forkedFrom ?? null),
    visibility: "private",
    forkCount: 0,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * "제목 (사본)"인 새 문서를 만든다. 제목은 사본 표시를 붙여도 최대 길이를 넘지 않게
 * 자른다. 항목·덱 id를 모두 새로 발급한다. 덱 id가 원본과 같으면 서버의 `decks`
 * 기본키를 위반해 사본이 영영 저장되지 않는다. 공유 정보(`access`)는 떼어 내 내
 * 소유의 독립 문서가 된다. 서버가 확정한 적 없는 새 판(기준 판 `null`)이다.
 *
 * `trashedAt`은 휴지통에 있던 세트의 편집을 사본으로 남길 때 그 자리를 지키려고 받는다. 주지
 * 않으면 휴지통 밖이다.
 */
export function buildPresentationCopy(
  source: Presentation,
  {
    userId,
    folderId,
    trashedAt = null,
    now,
  }: {
    userId: string;
    folderId: string | null;
    trashedAt?: string | null;
    now: string;
  },
): Presentation {
  const newId = createId();
  const items = source.items.map((item): PresentationItem => {
    const deckId = createId();
    return {
      ...item,
      id: createId(),
      presentationId: newId,
      deckId,
      deck: item.deck
        ? {
            ...cloneDeck(item.deck),
            id: deckId,
            userId,
            presentationId: newId,
            createdAt: now,
            updatedAt: now,
          }
        : undefined,
    };
  });

  const copy: Presentation = {
    ...source,
    id: newId,
    userId,
    title: appendWithinLimit(
      source.title,
      COMMON_COPY.copySuffix,
      MAX_PRESENTATION_TITLE_LENGTH,
    ),
    items,
    folderId,
    trashedAt,
    createdAt: now,
    updatedAt: now,
    baseUpdatedAt: null,
  };
  delete copy.access;
  return copy;
}
