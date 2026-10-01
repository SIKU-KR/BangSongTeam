import React from "react";
import type { Deck } from "#shared";
import { deleteUserSong, updateLibrarySongInfo } from "../songLibraryStore";
import { SongInfoDialog } from "../SongInfoDialog";
import { ConfirmDialog } from "../../drive/DriveDialogs";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export type LibrarySongDialogRequest = { kind: "edit" | "delete"; deck: Deck };

/**
 * 곡 선택 창에서 보관함 곡의 정보 수정·삭제를 묻는 대화 상자. 공개한 곡은 고치거나
 * 지우면 공유 라이브러리에도 그대로 반영되므로 그 사실을 함께 알린다. 확인하면 보관함
 * 스토어에 바로 반영하고, 확인이든 취소든 끝나면 `onDone`을 부른다.
 */
export function LibrarySongDialog({
  request,
  onDone,
}: {
  request: LibrarySongDialogRequest;
  onDone: () => void;
}): React.JSX.Element {
  const { deck } = request;
  const isPublic = deck.visibility === "public";

  if (request.kind === "edit") {
    return (
      <SongInfoDialog
        heading={EDITOR_COPY.picker.editLibraryTitle}
        initialValues={{ title: deck.title, artist: deck.artist }}
        notice={
          isPublic
            ? EDITOR_COPY.picker.editPublicNotice
            : EDITOR_COPY.picker.editNotice
        }
        onSubmit={(values) => {
          updateLibrarySongInfo(deck.id, values);
          onDone();
        }}
        onCancel={onDone}
      />
    );
  }

  return (
    <ConfirmDialog
      title={EDITOR_COPY.picker.deleteTitle}
      message={
        <>
          {EDITOR_COPY.picker.deleteMessage(deck.title)}
          {isPublic && EDITOR_COPY.picker.deletePublicNote}
        </>
      }
      confirmLabel={COMMON_COPY.delete}
      onConfirm={() => {
        deleteUserSong(deck.id);
        onDone();
      }}
      onCancel={onDone}
    />
  );
}
