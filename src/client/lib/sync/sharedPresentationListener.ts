import { toast } from "sonner";
import {
  getPresentationById,
  removePresentationsLocally,
  replaceWithServerDocument,
} from "../../features/presentation";
import type { SharedPresentationListener } from "./presentationSync";
import { PRESENTATION_COPY } from "#copy/presentation";

/** 공유받은 세트의 최신본·접근 상실을 로컬 스토어에 반영한다. */
export const sharedPresentationListener: SharedPresentationListener = {
  replaced: (document) => replaceWithServerDocument(document),
  lost: (id) => {
    if (!getPresentationById(id)) return;
    void removePresentationsLocally([id]);
    toast.info(PRESENTATION_COPY.sharedRevoked);
  },
};
