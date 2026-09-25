/**
 * 글꼴 드롭다운 미리보기 이미지 생성기.
 *
 * 드롭다운이 목록의 글꼴 파일(한글 전체 폰트, 1~5 MB)을 모두 받지 않도록, 각 글꼴의
 * 이름을 그 글꼴로 그린 흰 글씨·투명 배경 WebP를 `src/client/public/font-previews/<id>.webp`
 * 로 만든다. 앱은 이 이미지를 CSS mask로 써서 테마 글자색으로 칠한다.
 *
 * 눈누 카탈로그(`src/shared/constants/noonnuFontCatalog.ts`)가 바뀌면 다시 실행해 결과를 커밋한다.
 * 이미 있는 파일은 건너뛰므로 전체를 다시 그리려면 `--force`를 붙인다.
 *
 *   pnpm fonts:previews [--force]
 *
 * 설치된 Chrome을 DevTools 프로토콜로 직접 구동한다 (경로는 `CHROME_PATH`로 바꿀 수 있다).
 * `.ts` 카탈로그를 바로 import하므로 Node 23.6 이상이 필요하다.
 */
/* global document, FontFace, requestAnimationFrame -- renderInPage는 Chrome 페이지 안에서 실행된다 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOONNU_FONTS } from "../src/shared/constants/noonnuFontCatalog.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src/client/public/font-previews");
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 드롭다운 항목(`text-sm`, `h-6`)과 같은 CSS px. 이미지는 2배로 그린다. */
const FONT_SIZE = 15;
const HEIGHT = 24;
const MAX_WIDTH = 224;
const SCALE = 2;
const LOAD_TIMEOUT_MS = 30_000;

const force = process.argv.includes("--force");

async function launchChrome() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "font-previews-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]);
  const browserUrl = await new Promise((resolve, reject) => {
    let buffer = "";
    chrome.stderr.on("data", (chunk) => {
      buffer += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) resolve(match[1]);
    });
    chrome.on("exit", (code) => reject(new Error(`Chrome 종료 (${code})`)));
  });
  const { port } = new URL(browserUrl);
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const page = targets.find((target) => target.type === "page");
  return {
    pageUrl: page.webSocketDebuggerUrl,
    close: async () => {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

/** 페이지 안에서 실행된다: 글꼴을 불러 이름을 그리고, 잘라 낼 너비와 로드 성공 여부를 돌려준다. */
async function renderInPage(font, options) {
  document.head.querySelectorAll("[data-preview]").forEach((el) => el.remove());
  for (const face of [...document.fonts]) document.fonts.delete(face);

  const withTimeout = (promise) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), options.timeout),
      ),
    ]);

  const weight = font.weight && font.weight !== "normal" ? font.weight : "400";
  const url = font.url.startsWith("//") ? `https:${font.url}` : font.url;
  let family = "font-preview";
  let error = null;
  try {
    if (font.format === "css") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.preview = "";
      await withTimeout(
        new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = () => reject(new Error("css load failed"));
          document.head.appendChild(link);
        }),
      );
      family = font.name;
      await withTimeout(
        document.fonts.load(
          `${weight} ${options.fontSize}px "${family}"`,
          font.name,
        ),
      );
      if (
        !document.fonts.check(
          `${weight} ${options.fontSize}px "${family}"`,
          font.name,
        )
      ) {
        throw new Error("css font not available");
      }
    } else {
      const face = new FontFace(
        family,
        `url("${url}") format("${font.format || "woff2"}")`,
        { weight },
      );
      await withTimeout(face.load());
      document.fonts.add(face);
    }
  } catch (cause) {
    error = String(cause?.message ?? cause);
  }

  const el = document.getElementById("preview");
  el.style.fontFamily = `"${family}", sans-serif`;
  el.style.fontWeight = weight;
  el.textContent = font.name;
  await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  return {
    width: Math.min(Math.ceil(el.scrollWidth), options.maxWidth),
    error,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const chrome = await launchChrome();
  const cdp = await connect(chrome.pageUrl);
  const failures = [];
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: MAX_WIDTH + 16,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    await cdp.send("Runtime.evaluate", {
      expression: `document.documentElement.style.background = "transparent";
        document.body.style.cssText = "margin:0;background:transparent";
        document.body.innerHTML = '<div id="preview" style="display:inline-block;height:${HEIGHT}px;line-height:${HEIGHT}px;font-size:${FONT_SIZE}px;color:#fff;white-space:nowrap;padding:0 1px"></div>';`,
    });

    let done = 0;
    for (const font of NOONNU_FONTS) {
      done += 1;
      const file = path.join(OUT_DIR, `${font.id}.webp`);
      if (!force && existsSync(file)) continue;

      const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
        expression: `(${renderInPage})(${JSON.stringify(font)}, ${JSON.stringify(
          {
            fontSize: FONT_SIZE,
            maxWidth: MAX_WIDTH,
            timeout: LOAD_TIMEOUT_MS,
          },
        )})`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      const { width, error } = result.value;
      if (error) failures.push(`${font.id} ${font.name}: ${error}`);

      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: 90,
        clip: { x: 0, y: 0, width, height: HEIGHT, scale: 1 },
      });
      writeFileSync(file, Buffer.from(data, "base64"));
      process.stdout.write(`\r${done}/${NOONNU_FONTS.length}`);
    }
  } finally {
    cdp.close();
    await chrome.close();
  }
  process.stdout.write("\n");
  if (failures.length > 0) {
    console.warn(
      `글꼴을 불러오지 못해 대체 글꼴로 그린 항목 ${failures.length}개:\n${failures.join("\n")}`,
    );
  }
}

await main();
