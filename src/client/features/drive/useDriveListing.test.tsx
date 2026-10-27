import React, { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
} from "../presentation/presentationStore";
import { resetFolderStore } from "./folderStore";
import { DEFAULT_SORT_ORDER } from "./driveModel";
import { useDriveListing } from "./useDriveListing";

function Probe({
  searchQuery,
  committed,
}: {
  searchQuery: string;
  committed: string[];
}): null {
  const { query } = useDriveListing({
    isTrash: false,
    folderId: null,
    searchQuery,
    sortOrder: DEFAULT_SORT_ORDER,
    typeFilter: "all",
  });
  useEffect(() => {
    committed.push(query);
  });
  return null;
}

describe("useDriveListing 검색어", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  it("검색어를 치면 입력을 먼저 그리고 검색 결과는 뒤따라 그린다", () => {
    const committed: string[] = [];
    const { rerender } = render(<Probe searchQuery="" committed={committed} />);
    committed.length = 0;

    rerender(<Probe searchQuery=" 주일 " committed={committed} />);

    expect(committed).toEqual(["", "주일"]);
  });

  it("검색어를 지우면 늦은 검색 결과를 한 번 더 그리지 않고 곧바로 폴더 내용을 보여 준다", () => {
    const committed: string[] = [];
    const { rerender } = render(
      <Probe searchQuery="주일" committed={committed} />,
    );
    committed.length = 0;

    rerender(<Probe searchQuery="  " committed={committed} />);

    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((query) => query === "")).toBe(true);
  });
});
