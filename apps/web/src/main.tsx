import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

// 앱 셸·폰트·배경 영상을 오프라인에서 쓰기 위한 Service Worker 등록.
// 갱신은 자동 적용하지 않는다 (AppUpdateBanner가 사용자에게 시점을 넘긴다).
registerServiceWorker();

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
