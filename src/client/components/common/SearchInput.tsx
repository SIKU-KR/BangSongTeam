import React from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import { COMMON_COPY } from "#copy/common";

interface SearchInputProps {
  value: string;
  onValueChange: (next: string) => void;
  /** 보이는 레이블이 없어 `aria-label`로만 붙는 입력란 이름 */
  label: string;
  placeholder?: string;
  testId?: string;
  /** 있으면 Enter나 '검색' 버튼으로 제출할 때만 검색한다 (요청 비용이 큰 검색) */
  onSubmit?: () => void;
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
  onSubmit,
}: SearchInputProps): React.JSX.Element {
  const field = (
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
      {(value || onSubmit) && (
        <InputGroupAddon align="inline-end">
          {value && (
            <InputGroupButton
              size="icon-xs"
              aria-label={COMMON_COPY.clearSearch}
              onClick={() => onValueChange("")}
            >
              <XIcon />
            </InputGroupButton>
          )}
          {onSubmit && (
            <InputGroupButton
              type="submit"
              variant="secondary"
              disabled={value.trim() === ""}
            >
              {COMMON_COPY.search}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
  if (!onSubmit) return field;
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {field}
    </form>
  );
}
