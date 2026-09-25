import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ShareSettings } from "#shared";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import { PresentationShareDialog } from "./PresentationShareDialog";

const ID = "p0000000000000000000a";

describe("PresentationShareDialog (세트 링크 공유)", () => {
  let api: FakeApi;
  let settings: ShareSettings;

  beforeEach(() => {
    settings = { access: "off", token: null };
    api = installFakeApi({
      "GET /api/presentations/*/share": () => ({ body: settings }),
      "PUT /api/presentations/*/share": ({ body }) => {
        const { access } = body as { access: ShareSettings["access"] };
        settings = { access, token: settings.token ?? "tok-first" };
        return { body: settings };
      },
      "POST /api/presentations/*/share/reset": () => {
        settings = { ...settings, token: "tok-second" };
        return { body: settings };
      },
    });
  });

  afterEach(() => api.restore());

  function renderDialog() {
    return render(
      withQueryClient(
        <PresentationShareDialog
          presentationId={ID}
          title="주일 1부 예배"
          isOpen
          onClose={() => {}}
        />,
      ),
    );
  }

  it("링크가 꺼져 있으면 주소를 보여 주지 않는다", async () => {
    renderDialog();
    expect(await screen.findByTestId("share-access-select")).toHaveTextContent(
      "제한됨",
    );
    expect(screen.queryByTestId("share-link-input")).not.toBeInTheDocument();
  });

  it("보기 가능으로 바꾸면 /s/ 링크가 나타난다", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-access-select"));
    const option = await screen.findByRole("option", {
      name: "링크가 있는 사람은 보기 가능",
    });
    fireEvent.pointerDown(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);

    await waitFor(() =>
      expect(screen.getByTestId("share-link-input")).toHaveValue(
        `${window.location.origin}/s/tok-first`,
      ),
    );
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({
      access: "view",
    });
  });

  it("링크를 재설정하면 새 주소로 바뀐다", async () => {
    settings = { access: "view", token: "tok-first" };
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-reset-btn"));
    fireEvent.click(await screen.findByTestId("share-reset-confirm-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("share-link-input")).toHaveValue(
        `${window.location.origin}/s/tok-second`,
      ),
    );
  });
});
