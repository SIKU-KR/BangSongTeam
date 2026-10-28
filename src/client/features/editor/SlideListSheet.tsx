import React from "react";
import { XIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "#components/ui/sheet";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

interface SlideListSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 시트 안에 놓을 슬라이드 썸네일 창. 열려 있는 동안만 그린다 */
  children: React.ReactNode;
}

/**
 * 폰 폭(md 미만)에서 슬라이드 썸네일 창을 담는 왼쪽 시트.
 *
 * 256px 창을 붙여 두면 무대에 119px만 남아서, 평소에는 접어 두고 슬라이드 목록 버튼으로 연다.
 * 대화 상자라 열리는 동안 포커스가 시트 안에 머물고, Esc·바깥 누르기·닫기 버튼으로 닫는다. 창은
 * 열려 있는 동안만 그리므로, 닫았다 열어도 남아야 하는 상태(접은 곡 구역)는 창이 아니라 시트를
 * 담는 쪽이 쥔다.
 */
export function SlideListSheet({
  open,
  onOpenChange,
  children,
}: SlideListSheetProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        data-testid="slide-list-sheet"
        className="gap-0 p-0"
      >
        <SheetTitle className="sr-only">
          {EDITOR_COPY.thumbnails.list}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {EDITOR_COPY.thumbnails.listHint}
        </SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/**
 * 시트 안 썸네일 창의 머리줄 끝에 놓는 닫기 버튼. 시트 기본 닫기 버튼은 오른쪽 위에 겹쳐 놓여
 * 머리줄의 새 슬라이드 버튼을 가리므로 쓰지 않는다.
 */
export function SlideListCloseButton(): React.JSX.Element {
  return (
    <SheetClose
      data-testid="slide-list-close-btn"
      render={<Button variant="ghost" size="icon-sm" />}
    >
      <XIcon />
      <span className="sr-only">{COMMON_COPY.close}</span>
    </SheetClose>
  );
}
