import React from "react";
import {
  CopyIcon,
  FoldVerticalIcon,
  PlusIcon,
  SeparatorHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { RibbonButton, RibbonGroup } from "./RibbonPrimitives";
import { EDITOR_COPY } from "#copy/editor";

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
    <RibbonGroup label={EDITOR_COPY.slide.label}>
      <RibbonButton
        label={EDITOR_COPY.slide.add}
        tooltip={EDITOR_COPY.ribbon.addSlideTooltip}
        testId="ribbon-new-slide-btn"
        text={EDITOR_COPY.slide.add}
        disabled={!hasSlide}
        onClick={onAdd}
        icon={<PlusIcon />}
      />
      <RibbonButton
        label={EDITOR_COPY.slide.duplicate}
        tooltip={EDITOR_COPY.ribbon.duplicateSlideTooltip}
        testId="ribbon-duplicate-slide-btn"
        disabled={!hasSlide}
        onClick={onDuplicate}
        icon={<CopyIcon />}
      />
      <RibbonButton
        label={EDITOR_COPY.slide.delete}
        tooltip={
          canDelete
            ? EDITOR_COPY.ribbon.deleteSlideTooltip
            : EDITOR_COPY.slide.lastCannotDelete
        }
        testId="ribbon-delete-slide-btn"
        disabled={!canDelete}
        onClick={onDelete}
        icon={<Trash2Icon />}
      />
      <RibbonButton
        label={EDITOR_COPY.slide.split}
        tooltip={splitTitle}
        testId="split-slide-btn"
        text={EDITOR_COPY.slide.splitShort}
        disabled={!canSplit}
        onClick={onSplit}
        icon={<SeparatorHorizontalIcon />}
      />
      <RibbonButton
        label={EDITOR_COPY.slide.merge}
        tooltip={mergeTitle}
        testId="merge-slide-btn"
        text={EDITOR_COPY.slide.mergeShort}
        disabled={!canMerge}
        onClick={onMerge}
        icon={<FoldVerticalIcon />}
      />
    </RibbonGroup>
  );
}
