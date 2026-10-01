import type { Deck, Presentation, PresentationItem } from "#shared";
import { MAX_PRESENTATION_TITLE_LENGTH, createId } from "#shared";
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
    let changed = false;

    const items = doc.items.map((item) => {
      const deck = item.deck;
      if (!deck) return item;

      if (!seen.has(deck.id)) {
        seen.add(deck.id);
        if (item.deckId === deck.id) return item;
        changed = true;
        return { ...item, deckId: deck.id };
      }

      changed = true;
      const newId = createId();
      seen.add(newId);
      return {
        ...item,
        deckId: newId,
        deck: { ...deck, id: newId, forkedFrom: deck.forkedFrom ?? deck.id },
      };
    });

    if (!changed) return doc;
    repairedIds.push(doc.id);
    return { ...doc, items };
  });

  return { documents: repaired, repairedIds };
}

/**
 * 되돌리기 기록의 문서에 지금 문서의 폴더·휴지통 배치를 입힌다. 이동·휴지통은
 * 편집 기록을 남기지 않으므로, 되돌리기가 문서를 다른 폴더로 옮기면 안 된다.
 */
export function withCurrentPlacement(
  snapshot: Presentation,
  current: Presentation,
): Presentation {
  const next: Presentation = { ...snapshot };
  delete next.folderId;
  delete next.trashedAt;
  if (current.folderId !== undefined) next.folderId = current.folderId;
  if (current.trashedAt !== undefined) next.trashedAt = current.trashedAt;
  return next;
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
 * 소유의 독립 문서가 된다.
 */
export function buildPresentationCopy(
  source: Presentation,
  {
    userId,
    folderId,
    now,
  }: { userId: string; folderId: string | null; now: string },
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
    title: `${source.title.slice(0, MAX_PRESENTATION_TITLE_LENGTH - COMMON_COPY.copySuffix.length)}${COMMON_COPY.copySuffix}`,
    items,
    folderId,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  delete copy.access;
  return copy;
}
