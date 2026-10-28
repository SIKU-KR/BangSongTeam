import { getPresentationById } from "../../features/presentation/presentationStore";
import type { OwnPresentationListener } from "./presentationSync";
import { scheduleDocumentPush } from "./syncScheduler";

/**
 * 내 프레젠테이션 push가 스토어의 지금 판을 올리고, 송출 중에 보내지 못한 세트를 큐에 다시 넣게
 * 한다(`OwnPresentationListener`). 다시 넣을 때도 큐에 남은 사본이 아니라 지금 판을 넣고, 그사이
 * 지운 세트는 넣지 않는다.
 */
export const ownPresentationListener: OwnPresentationListener = {
  current: (id) => getPresentationById(id),
  requeue: (id) => {
    const current = getPresentationById(id);
    if (current) scheduleDocumentPush(current);
  },
};
