import React from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import { COMMON_COPY } from "#copy/common";

export interface SearchInputProps {
  value: string;
  onValueChange: (next: string) => void;
  /** 보이는 레이블이 없어 `aria-label`로만 붙는 입력란 이름 */
  label: string;
  placeholder?: string;
  testId?: string;
}

/**
 * 돋보기 아이콘이 붙은 검색 입력란. 입력이 있을 때만 지우기 버튼이 나타난다.
 */
export function SearchInput({
  value,
  onValueChange,
  label,
  placeholder,
  testId,
}: SearchInputProps): React.JSX.Element {
  return (
    <InputGroup>
      <InputGroupInput
        type="text"
        data-testid={testId}
        aria-label={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
      />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={COMMON_COPY.clearSearch}
            onClick={() => onValueChange("")}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
