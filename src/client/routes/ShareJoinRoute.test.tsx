import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import type { PresentationDocument } from "#shared";
import { signInAsTestUser } from "../test/sessionFixture";
import { installFakeApi, type FakeApi } from "../test/fakeApi";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../features/presentation/mockPresentations";
import {
  getPresentationById,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import { ShareJoinRoute } from "./ShareJoinRoute";

const OWNER = "0000000000000000owner";

function EditorProbe(): React.JSX.Element {
  const { presentationId } = useParams();
  return <p data-testid="editor-probe">{presentationId}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:token" element={<ShareJoinRoute />} />
        <Route path="/editor/:presentationId" element={<EditorProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ShareJoinRoute (/s/:token)", () => {
  let api: FakeApi | null = null;
  const shared = {
    ...SEED_PRESENTATIONS[0],
    userId: OWNER,
    access: { ownerName: "인도자", memberId: SEED_USER_ID },
  } as PresentationDocument;

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
  });

  afterEach(() => api?.restore());

  it("링크로 받은 세트를 로컬에 넣고 편집기로 보낸다", async () => {
    api = installFakeApi({
      "POST /api/share/*/join": () => ({
        body: { presentationId: shared.id, role: "viewer", document: shared },
      }),
    });
    renderAt("/s/tok-first");

    expect(await screen.findByTestId("editor-probe")).toHaveTextContent(
      shared.id,
    );
    expect(getPresentationById(shared.id)?.access?.ownerName).toBe("인도자");
  });

  it("만료된 링크는 안내를 보여 준다", async () => {
    api = installFakeApi({
      "POST /api/share/*/join": () => ({
        status: 404,
        body: { error: "링크가 만료되었거나 공유가 해제되었습니다" },
      }),
    });
    renderAt("/s/expired");

    expect(await screen.findByTestId("share-join-error")).toHaveTextContent(
      "링크가 만료되었거나 공유가 해제되었습니다",
    );
  });
});
