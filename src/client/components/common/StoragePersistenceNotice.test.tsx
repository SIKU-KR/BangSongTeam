import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoragePersistenceNotice } from "./StoragePersistenceNotice";
import {
  __resetStoragePersistenceForTests,
  requestPersistentStorage,
} from "../../lib/offline/storagePersistence";
import { SHELL_COPY } from "#copy/shell";

const original = Object.getOwnPropertyDescriptor(navigator, "storage");

function notice(): HTMLElement | null {
  return screen.queryByTestId("storage-persistence-notice");
}

async function settle(storage: unknown): Promise<void> {
  Object.defineProperty(navigator, "storage", {
    value: storage,
    configurable: true,
  });
  await act(async () => {
    await requestPersistentStorage();
  });
}

const DENIED = { persisted: async () => false, persist: async () => false };

describe("StoragePersistenceNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetStoragePersistenceForTests();
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, "storage", original);
    } else {
      Reflect.deleteProperty(navigator, "storage");
    }
  });

  it("브라우저가 저장소를 지울 수 있으면 앱으로 설치하라고 안내한다", async () => {
    render(<StoragePersistenceNotice />);
    expect(notice()).toBeNull();

    await settle(DENIED);

    expect(notice()).toHaveTextContent(SHELL_COPY.storagePersistence.title);
    expect(notice()).toHaveTextContent(
      SHELL_COPY.storagePersistence.description,
    );
  });

  it.each([
    ["영구 저장을 허락받았으면", { persisted: async () => true }],
    ["영구 저장을 지원하지 않으면", undefined],
  ])("%s 띄우지 않는다", async (_, storage) => {
    render(<StoragePersistenceNotice />);

    await settle(storage);

    expect(notice()).toBeNull();
  });

  it("닫으면 다시 띄우지 않는다", async () => {
    const { unmount } = render(<StoragePersistenceNotice />);
    await settle(DENIED);

    fireEvent.click(
      screen.getByRole("button", {
        name: SHELL_COPY.storagePersistence.dismiss,
      }),
    );
    expect(notice()).toBeNull();

    unmount();
    render(<StoragePersistenceNotice />);
    expect(notice()).toBeNull();
  });
});
