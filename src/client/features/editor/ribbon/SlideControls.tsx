import React from "react";
import { RibbonButton, RibbonGroup, RibbonIcon } from "./RibbonPrimitives";

export interface SlideControlsProps {
  hasSlide: boolean;
  canDelete: boolean;
  canSplit: boolean;
  canMerge: boolean;
  splitTitle: string;
  mergeTitle: string;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onMerge: () => void;
}

/** 리본 '슬라이드' 그룹: 새로 만들기·복제·삭제·나누기·합치기 */
export function SlideControls({
  hasSlide,
  canDelete,
  canSplit,
  canMerge,
  splitTitle,
  mergeTitle,
  onAdd,
  onDuplicate,
  onDelete,
  onSplit,
  onMerge,
}: SlideControlsProps): React.JSX.Element {
  return (
    <RibbonGroup label="슬라이드">
      <RibbonButton
        label="새 슬라이드"
        title="새 슬라이드 (Ctrl/⌘+M)"
        testId="ribbon-new-slide-btn"
        text="새 슬라이드"
        disabled={!hasSlide}
        onClick={onAdd}
        icon={<RibbonIcon d="M12 4v16m8-8H4" />}
      />
      <RibbonButton
        label="슬라이드 복제"
        title="슬라이드 복제 (Ctrl/⌘+D)"
        testId="ribbon-duplicate-slide-btn"
        disabled={!hasSlide}
        onClick={onDuplicate}
        icon={
          <RibbonIcon d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        }
      />
      <RibbonButton
        label="슬라이드 삭제"
        title={
          canDelete
            ? "슬라이드 삭제 (Delete)"
            : "곡의 마지막 한 장은 지울 수 없습니다"
        }
        testId="ribbon-delete-slide-btn"
        disabled={!canDelete}
        onClick={onDelete}
        icon={
          <RibbonIcon d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        }
      />
      <RibbonButton
        label="슬라이드 나누기"
        title={splitTitle}
        testId="split-slide-btn"
        text="나누기"
        disabled={!canSplit}
        onClick={onSplit}
        icon={<RibbonIcon d="M4 5h16M4 19h16M4 12h3m3 0h4m3 0h3" />}
      />
      <RibbonButton
        label="다음 슬라이드와 합치기"
        title={mergeTitle}
        testId="merge-slide-btn"
        text="합치기"
        disabled={!canMerge}
        onClick={onMerge}
        icon={<RibbonIcon d="M4 5h16M4 19h16M12 8v8m-3-3l3 3 3-3" />}
      />
    </RibbonGroup>
  );
}
