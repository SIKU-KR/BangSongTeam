import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { ChromeAlertBanner } from "./components/common/ChromeAlertBanner";
import { SlideStage } from "./components/stage/SlideStage";
import { DEFAULT_DECK_STYLE } from "@repo/shared";

function App(): React.JSX.Element {
  const sampleSlide = {
    id: "s_demo",
    order: 0,
    lines: ["꽃들도 구름도 바람도 넓은 바다도", "찬양하라 찬양하라 예수를"],
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex flex-col">
      <ChromeAlertBanner />
      <main className="flex-1 w-full h-full relative">
        <SlideStage slide={sampleSlide} style={DEFAULT_DECK_STYLE} />
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
