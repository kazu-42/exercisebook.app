import { Buffer } from "node:buffer";

import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";

import fontMetadata from "../assets/fonts/noto-sans-jp/metadata.json";

export type BrowserPdfBinding = Parameters<typeof puppeteer.launch>[0];
export const RENDERER_VERSION = "cloudflare-puppeteer-1.4.0";
export const BROWSER_PDF_FONT_SHA256 =
  "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f";

const FONT_BYTES = 9_589_900;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
// A base64 copy of the full CJK font is sent over CDP. Avoid multiplying that
// memory use inside a 128 MiB Worker; account-wide quotas remain authoritative.
let activeRender = false;

function deadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    operation.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function verifiedFontDataUrl(font: Uint8Array): Promise<string> {
  if (
    font.byteLength !== FONT_BYTES ||
    fontMetadata.sha256 !== BROWSER_PDF_FONT_SHA256 ||
    fontMetadata.bytes !== FONT_BYTES ||
    fontMetadata.license !== "OFL-1.1"
  ) {
    throw new Error("The pinned PDF font is missing or invalid.");
  }
  const digest = await crypto.subtle.digest("SHA-256", font.slice().buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== BROWSER_PDF_FONT_SHA256)
    throw new Error("The pinned PDF font failed integrity verification.");
  return `data:font/ttf;base64,${Buffer.from(font.buffer, font.byteOffset, font.byteLength).toString("base64")}`;
}

async function verifyActualFonts(page: Page): Promise<void> {
  const session = await page.createCDPSession();
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "body, body *",
    });
    if (nodeIds.length === 0 || nodeIds.length > 1_024)
      throw new Error("PDF document exceeds its font validation limit.");
    let usedGlyphs = false;
    // Bounded batches avoid one network round trip per text node without
    // flooding the browser's CDP connection with unbounded work.
    for (let offset = 0; offset < nodeIds.length; offset += 16) {
      const responses = await Promise.all(
        nodeIds
          .slice(offset, offset + 16)
          .map((nodeId) => session.send("CSS.getPlatformFontsForNode", { nodeId })),
      );
      for (const { fonts } of responses) {
        for (const font of fonts) {
          if (!font.glyphCount) continue;
          usedGlyphs = true;
          if (!font.isCustomFont || !font.postScriptName.startsWith("NotoSansJP-"))
            throw new Error(
              "PDF rendering used an unpinned font or an unsupported glyph.",
            );
        }
      }
    }
    if (!usedGlyphs) throw new Error("PDF rendering did not use the pinned font.");
  } finally {
    await session.detach();
  }
}

/**
 * Renders HTML produced by the trusted print projector for a stored workbook.
 * Never pass client HTML or URLs. The caller owns authorization, stored-instance
 * integrity, immutable artifact storage, and reporting unexpected failures.
 */
export async function renderBrowserPdf(
  binding: BrowserPdfBinding,
  html: string,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  if (
    Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES ||
    !html.startsWith("<!doctype html>") ||
    html.split("</head>").length !== 2
  ) {
    throw new Error("PDF input is oversized or is not a trusted print document.");
  }
  const expectedPages = html.match(/class="sheet (?:student|answers)"/g)?.length ?? 0;
  if (expectedPages < 1 || expectedPages > 2)
    throw new Error("PDF input pages must contain one or two A4 sheets.");
  if (activeRender) throw new Error("The PDF renderer is busy. Please retry.");
  activeRender = true;
  let browser: Browser | undefined;
  let expired = false;
  const abort = new AbortController();
  let closePromise: Promise<void> | undefined;
  const closeBrowser = (): Promise<void> => {
    if (!browser) return Promise.resolve();
    closePromise ??= deadline(
      browser.close(),
      CLOSE_TIMEOUT_MS,
      "The PDF browser could not close within its time limit.",
    );
    return closePromise;
  };
  // Propagate the deadline to browser acquisition and websocket upgrade fetches.
  const timedBinding: BrowserPdfBinding = {
    fetch: (input, init) => binding.fetch(input, { ...init, signal: abort.signal }),
  };
  const render = async (): Promise<Uint8Array> => {
    const fontDataUrl = await verifiedFontDataUrl(fontBytes);
    const fontCss = `@font-face { font-family: "Workbook Noto Sans JP"; src: url("${fontDataUrl}") format("truetype"); font-style: normal; font-weight: 100 900; font-display: block; }`;
    if (expired) throw new Error("PDF rendering exceeded its time limit.");
    browser = await puppeteer.launch(timedBinding, {
      keep_alive: 10_000,
      guardrails: { allowedDomains: [] },
    });
    if (expired) {
      await closeBrowser();
      throw new Error("PDF browser acquisition exceeded its time limit.");
    }
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    await page.setJavaScriptEnabled(false);
    await page.setBypassServiceWorker(true);
    await page.setOfflineMode(true);
    await page.setRequestInterception(true);
    let attemptedNetwork = false;
    let interceptionFailed = false;
    page.on("request", (request) => {
      // Chromium emits request events for data URLs too. Only these exact,
      // hash-verified inline font bytes are allowed; no network request is.
      if (request.url() === fontDataUrl && request.resourceType() === "font") {
        void request.continue().catch(() => {
          interceptionFailed = true;
        });
        return;
      }
      attemptedNetwork = true;
      // URLs can carry content or secrets; record neither URLs nor request bodies.
      void request.abort("blockedbyclient").catch(() => {
        interceptionFailed = true;
      });
    });
    await page.emulateMediaType("print");
    await page.setContent(html.replace("</head>", `<style>${fontCss}</style></head>`), {
      waitUntil: "load",
      timeout: 10_000,
    });
    if (attemptedNetwork || interceptionFailed)
      throw new Error("PDF document attempted a network request.");
    const fontsLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = await document.fonts.load(
        '400 12px "Workbook Noto Sans JP"',
        "数学 x − × ÷",
      );
      return faces.length > 0 && faces.every((face) => face.status === "loaded");
    });
    if (!fontsLoaded) throw new Error("The pinned PDF font failed to load.");
    await verifyActualFonts(page);
    const layout = await page.evaluate(() => {
      const sheets = [...document.querySelectorAll<HTMLElement>(".sheet")];
      const nodes = [
        ...document.querySelectorAll<HTMLElement>(
          ".problem-grid, .answer-list, .problem-card, .solution-card, .lesson",
        ),
      ];
      return {
        pages: sheets.length,
        overflow: sheets.some(
          (node) =>
            node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1,
        ),
        clipped: nodes.some(
          (node) =>
            node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1,
        ),
      };
    });
    if (layout.pages !== expectedPages || layout.overflow || layout.clipped)
      throw new Error("PDF document exceeds its validated page layout.");
    const pdf = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      tagged: true,
      timeout: 10_000,
    });
    if (attemptedNetwork || interceptionFailed)
      throw new Error("PDF document attempted a network request.");
    if (
      pdf.byteLength < 100 ||
      pdf.byteLength > MAX_PDF_BYTES ||
      Buffer.from(pdf.subarray(0, 5)).toString("ascii") !== "%PDF-"
    )
      throw new Error(
        "Browser Run returned an invalid PDF or exceeded the output limit.",
      );
    return new Uint8Array(pdf);
  };
  try {
    return await deadline(
      render(),
      RENDER_TIMEOUT_MS,
      "PDF rendering exceeded its 30 second time limit.",
    );
  } finally {
    expired = true;
    try {
      await closeBrowser();
    } finally {
      abort.abort();
      activeRender = false;
    }
  }
}
