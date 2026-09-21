import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="w-full h-full flex items-center justify-center font-sans">
        Worship Slide
      </div>
    </React.StrictMode>,
  );
}
