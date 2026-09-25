import React from "react";
import {
  CopyIcon,
  FoldVerticalIcon,
  PlusIcon,
  SeparatorHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { RibbonButton, RibbonGroup } from "./RibbonPrimitives";

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
        tooltip="새 슬라이드 (Ctrl/⌘+M)"
        testId="ribbon-new-slide-btn"
        text="새 슬라이드"
        disabled={!hasSlide}
        onClick={onAdd}
        icon={<PlusIcon />}
      />
      <RibbonButton
        label="슬라이드 복제"
        tooltip="슬라이드 복제 (Ctrl/⌘+D)"
        testId="ribbon-duplicate-slide-btn"
        disabled={!hasSlide}
        onClick={onDuplicate}
        icon={<CopyIcon />}
      />
      <RibbonButton
        label="슬라이드 삭제"
        tooltip={
          canDelete
            ? "슬라이드 삭제 (Delete)"
            : "곡의 마지막 한 장은 지울 수 없습니다"
        }
        testId="ribbon-delete-slide-btn"
        disabled={!canDelete}
        onClick={onDelete}
        icon={<Trash2Icon />}
      />
      <RibbonButton
        label="슬라이드 나누기"
        tooltip={splitTitle}
        testId="split-slide-btn"
        text="나누기"
        disabled={!canSplit}
        onClick={onSplit}
        icon={<SeparatorHorizontalIcon />}
      />
      <RibbonButton
        label="다음 슬라이드와 합치기"
        tooltip={mergeTitle}
        testId="merge-slide-btn"
        text="합치기"
        disabled={!canMerge}
        onClick={onMerge}
        icon={<FoldVerticalIcon />}
      />
    </RibbonGroup>
  );
}
