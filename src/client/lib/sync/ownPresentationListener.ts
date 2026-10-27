import { toast } from "sonner";
import type { Presentation } from "#shared";
import {
  adoptServerPresentation,
  getPresentationById,
  keepUnsyncedCopy,
  markPresentationSynced,
  rebasePresentation,
  removePresentationsLocally,
  resolvePresentationConflict,
} from "../../features/presentation/presentationStore";
import { isProjecting } from "../../features/presentation/fullscreen";
import { getCurrentUserId } from "../auth/sessionStore";
import { PRESENTATION_COPY } from "#copy/presentation";
import type { OwnPresentationListener } from "./presentationSync";
import { isDocumentPushCancelled, scheduleDocumentPush } from "./syncScheduler";

const CONFLICT_TOAST_ID = "presentation-conflict";
const GONE_TOAST_ID = "presentation-gone";

const permanentDeletes = new Map<string, number>();

/**
 * 그 세트들을 영구 삭제하는 동안 부르고, 끝나면 돌려받은 함수를 부른다.
 *
 * 영구 삭제는 지우기 전에 큐에 남은 변경(휴지통에 넣기, 폴더 밖으로 꺼내기)을 먼저 올리는데, 그
 * 올리기가 엇갈림(412)이나 이미 영구 삭제함(410)으로 끝날 수 있다. 그동안 이 세트들은 엇갈려도 사본을
 * 남기지 않고 서버 판을 받고, 이미 지웠으면 사본도 알림도 없이 지운다. 사용자가 비우는 휴지통에 새
 * '(사본)'이 생기면 안 된다. 받은 서버 판을 지울지는 서버의 휴지통 검사가 정한다.
 */
export function beginPermanentDelete(ids: readonly string[]): () => void {
  const unique = [...new Set(ids)];
  for (const id of unique) {
    permanentDeletes.set(id, (permanentDeletes.get(id) ?? 0) + 1);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    for (const id of unique) {
      const remaining = (permanentDeletes.get(id) ?? 1) - 1;
      if (remaining > 0) permanentDeletes.set(id, remaining);
      else permanentDeletes.delete(id);
    }
  };
}

function appliesTo(id: string, server?: Presentation): boolean {
  const userId = getCurrentUserId();
  const current = getPresentationById(id);
  return (
    current !== undefined &&
    current.userId === userId &&
    (server === undefined || server.userId === userId) &&
    !isDocumentPushCancelled(id)
  );
}

function requeue(id: string): void {
  const current = getPresentationById(id);
  if (current) scheduleDocumentPush(current);
}

function deferredWhileProjecting(id: string): boolean {
  if (!isProjecting()) return false;
  requeue(id);
  return true;
}

/**
 * 내 프레젠테이션 push가 스토어의 지금 판을 올리고 그 결과를 스토어에 반영하게 한다
 * (`OwnPresentationListener`). 다시 넣을 때도 큐에 남은 사본이 아니라 지금 판을 넣고, 그사이 지운
 * 세트는 넣지 않는다.
 *
 * 결과는 먼저 거른다. 이 탭에 없는 세트, 지금 사용자의 것이 아닌 세트나 서버 판, 보내는 중에 취소한
 * push의 결과는 버린다. 로그아웃해도 스토어와 큐는 남으므로, 늦게 온 응답이 앞 계정의 세트를 다음
 * 계정에 넣거나 지운 세트를 되살리면 안 된다.
 *
 * 송출 중에는 서버 판 받기·엇갈림·영구 삭제를 하지 않고 그 세트를 큐에 다시 넣는다. 송출 화면은 띄운
 * 세트를 그대로 그려야 한다. 큐는 송출을 마친 뒤 고친 것이 있는 세트를 다시 올려 다시 견주고, 고친 것이
 * 없는 세트는 다음 부팅 병합이 서버 판에 맞춘다. 서버가 받은 판의 확정은 기준 판과 수정 시각만
 * 바꾸므로 송출 중에도 한다.
 *
 * 엇갈린 세트의 사본을 만들었거나 다른 곳에서 영구 삭제한 세트를 지웠으면 알림 하나로 알린다. 여러
 * 세트가 한꺼번에 그러면 같은 알림을 바꿔 띄운다.
 */
export const ownPresentationListener: OwnPresentationListener = {
  current: (id) => getPresentationById(id),
  requeue,
  saved: (sent, stored) => {
    if (appliesTo(sent.id)) markPresentationSynced(sent.id, sent, stored);
  },
  rebase: (id, base) => {
    if (appliesTo(id)) rebasePresentation(id, base);
  },
  adopt: (server) => {
    if (!appliesTo(server.id, server) || deferredWhileProjecting(server.id)) {
      return;
    }
    adoptServerPresentation(server);
  },
  conflict: (server) => {
    if (!appliesTo(server.id, server) || deferredWhileProjecting(server.id)) {
      return;
    }
    if (permanentDeletes.has(server.id)) {
      adoptServerPresentation(server);
      return;
    }
    const copy = resolvePresentationConflict(server);
    if (copy) {
      toast.info(PRESENTATION_COPY.conflictSavedAsCopy(copy.title), {
        id: CONFLICT_TOAST_ID,
      });
    }
  },
  gone: (id) => {
    if (!appliesTo(id) || deferredWhileProjecting(id)) return;
    if (permanentDeletes.has(id)) {
      void removePresentationsLocally([id]);
      return;
    }
    const copy = keepUnsyncedCopy(id);
    void removePresentationsLocally([id]);
    toast.info(
      copy
        ? PRESENTATION_COPY.deletedSavedAsCopy(copy.title)
        : PRESENTATION_COPY.deletedElsewhere,
      { id: GONE_TOAST_ID },
    );
  },
};
