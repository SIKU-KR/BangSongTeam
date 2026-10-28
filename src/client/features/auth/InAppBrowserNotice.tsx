import React from "react";
import { InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { AUTH_COPY } from "#copy/auth";
import { SHARING_COPY } from "#copy/sharing";
import { copyToClipboard } from "../../lib/browser/clipboard";
import {
  externalBrowserUrl,
  type InAppBrowser,
} from "../../lib/browser/inAppBrowser";

interface InAppBrowserNoticeProps {
  /** 지금 이 화면을 열어 준 앱 */
  browser: InAppBrowser;
}

/**
 * 앱 안 브라우저에서는 Google 로그인이 막힌다는 안내(`disallowed_useragent`). Google 로그인 버튼
 * 대신 보여 주고, 기기의 브라우저에서 같은 주소를 열게 돕는다.
 *
 * '다른 브라우저로 열기'는 앱이 직접 받아 주는 방법이 있을 때만 둔다(`externalBrowserUrl`). 나머지
 * 앱은 링크를 복사해 붙여 넣게 한다. 주소는 누르는 순간의 주소를 쓴다. 사본 만들기(`?copy=1`)처럼
 * 로그인하고 돌아올 자리를 담고 있다.
 */
export function InAppBrowserNotice({
  browser,
}: InAppBrowserNoticeProps): React.JSX.Element {
  const canOpenExternal =
    externalBrowserUrl(browser, window.location.href) !== null;

  const openExternal = (): void => {
    const url = externalBrowserUrl(browser, window.location.href);
    if (url) window.location.href = url;
  };

  const copyLink = async (): Promise<void> => {
    try {
      await copyToClipboard(window.location.href);
      toast.success(SHARING_COPY.link.copied);
    } catch {
      toast.error(SHARING_COPY.link.copyFailed);
    }
  };

  return (
    <Alert role="status" data-testid="in-app-browser-notice">
      <InfoIcon />
      <AlertDescription>{AUTH_COPY.inAppBrowser.notice}</AlertDescription>
      <div className="mt-2 flex flex-wrap gap-2">
        {canOpenExternal && (
          <Button size="sm" onClick={openExternal}>
            {AUTH_COPY.inAppBrowser.openExternal}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void copyLink()}>
          {AUTH_COPY.inAppBrowser.copyLink}
        </Button>
      </div>
    </Alert>
  );
}
