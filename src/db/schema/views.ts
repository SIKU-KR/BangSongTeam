import { and, count, eq, isNull, sql } from "drizzle-orm";
import { sqliteView } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { decks } from "./decks";
import { backgrounds } from "./media";

/**
 * 공유 라이브러리에 보이는 곡: 공개한 보관함 곡 중 게시 중단되지 않은 것.
 *
 * 공개 범위는 이 뷰 한 곳에서만 판정한다. 공개 곡을 읽는 쿼리(검색·상세·가져오기·
 * 신고)는 `decks`가 아니라 이 뷰를 읽는다. 조건은 부분 인덱스 `idx_decks_public`과
 * FTS 트리거(`0001_initial`)의 조건과 같다. 셋 중 하나만 바꾸지 않는다.
 */
export const publicDecks = sqliteView("public_decks").as((qb) =>
  qb
    .select({
      id: decks.id,
      userId: decks.userId,
      authorName: sql<string>`${user.name}`.as("author_name"),
      title: decks.title,
      artist: decks.artist,
      lyricsRaw: decks.lyricsRaw,
      slides: decks.slides,
      style: decks.style,
      backgroundId: decks.backgroundId,
      forkedFrom: decks.forkedFrom,
      forkedFromAuthorName: decks.forkedFromAuthorName,
      forkCount: decks.forkCount,
      publishedAt: decks.publishedAt,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .innerJoin(user, eq(user.id, decks.userId))
    .where(
      and(
        isNull(decks.presentationId),
        eq(decks.visibility, "public"),
        isNull(decks.takedownAt),
      ),
    ),
);

/** 배경마다 쓰는 곡 수 (보관함 곡과 프레젠테이션 사본 모두). 쓰지 않는 배경은 0이다. */
export const backgroundUsage = sqliteView("background_usage").as((qb) =>
  qb
    .select({
      backgroundId: sql<string>`${backgrounds.id}`.as("background_id"),
      deckCount: count(decks.id).as("deck_count"),
    })
    .from(backgrounds)
    .leftJoin(decks, eq(decks.backgroundId, backgrounds.id))
    .groupBy(backgrounds.id),
);
