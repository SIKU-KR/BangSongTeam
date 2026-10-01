import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

if (import.meta.env.DEV) {
  void import("react-grab");
}

registerServiceWorker();

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
