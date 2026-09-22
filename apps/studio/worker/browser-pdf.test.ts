import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@cloudflare/puppeteer", () => ({ default: { launch } }));

import { renderBrowserPdf, type BrowserPdfBinding } from "./browser-pdf.js";

const font = new Uint8Array(
  readFileSync(
    new URL("../assets/fonts/noto-sans-jp/NotoSansJP-wght.ttf", import.meta.url),
  ),
);
const html =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><section class="sheet student" data-instance-hash="abc"><p>数学 x − × ÷</p></section></body></html>';
const binding = { fetch: vi.fn() } as unknown as BrowserPdfBinding;
const pdf = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(100)}`);

function mockBrowser(postScriptName = "NotoSansJP-Thin_Regular", isCustomFont = true) {
  const session = {
    send: vi.fn(async (method: string) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelectorAll") return { nodeIds: [2] };
      if (method === "CSS.getPlatformFontsForNode")
        return {
          fonts: [
            {
              glyphCount: 10,
              isCustomFont,
              postScriptName,
            },
          ],
        };
      return {};
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
    setBypassServiceWorker: vi.fn().mockResolvedValue(undefined),
    setOfflineMode: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    emulateMediaType: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ pages: 1, overflow: false, clipped: false }),
    createCDPSession: vi.fn().mockResolvedValue(session),
    pdf: vi.fn().mockResolvedValue(pdf),
  };
  return {
    page,
    session,
    browser: {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("Cloudflare Browser Run PDF adapter", () => {
  beforeEach(() => launch.mockReset());
  afterEach(() => vi.useRealTimers());

  it("renders trusted HTML with verified inline Noto, A4 and guarded networking, then closes", async () => {
    const { browser, page } = mockBrowser();
    launch.mockResolvedValue(browser);
    await expect(renderBrowserPdf(binding, html, font)).resolves.toEqual(pdf);
    expect(launch.mock.calls[0]![1]).toMatchObject({
      guardrails: { allowedDomains: [] },
      keep_alive: 10_000,
    });
    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(page.setOfflineMode).toHaveBeenCalledWith(true);
    expect(page.setBypassServiceWorker).toHaveBeenCalledWith(true);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.setContent.mock.calls[0]![0]).toContain("data:font/ttf;base64,");
    expect(page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: "A4", preferCSSPageSize: true, tagged: true }),
    );
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("rejects corrupt and missing font bytes before acquiring a browser", async () => {
    await expect(renderBrowserPdf(binding, html, new Uint8Array())).rejects.toThrow(
      /font/i,
    );
    const damaged = font.slice();
    damaged[100] = damaged[100]! ^ 1;
    await expect(renderBrowserPdf(binding, html, damaged)).rejects.toThrow(/font/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([100, 400, 500, 600, 700, 900])(
    "accepts Cloud Browser's instanced Noto weight %i after checking the pinned bytes",
    async (weight) => {
      const { browser } = mockBrowser(`NotoSansJP_${weight}wght`);
      launch.mockResolvedValue(browser);
      await expect(renderBrowserPdf(binding, html, font)).resolves.toEqual(pdf);
      expect(browser.close).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["OtherFont_400wght", true],
    ["NotoSansJP_400wght", false],
    ["NotoSansJP_99wght", true],
    ["NotoSansJP_901wght", true],
    ["NotoSansJP_1000wght", true],
    ["NotoSansJP_400wghtExtra", true],
  ])("rejects an unapproved font identity %s / custom=%s", async (name, custom) => {
    const { browser, page } = mockBrowser(name, custom);
    launch.mockResolvedValue(browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/font/i);
    expect(page.pdf).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("allows only the exact verified inline font when Chromium emits a data URL request", async () => {
    const { browser, page } = mockBrowser();
    const continueRequest = vi.fn().mockResolvedValue(undefined);
    const abortRequest = vi.fn().mockResolvedValue(undefined);
    page.setContent.mockImplementationOnce(async (content: string) => {
      const listener = page.on.mock.calls.find(([event]) => event === "request")![1];
      const inlineFont = content.match(/url\("(data:font\/ttf;base64,[^"]+)"\)/)![1];
      listener({
        url: () => inlineFont,
        resourceType: () => "font",
        continue: continueRequest,
        abort: abortRequest,
      });
    });
    launch.mockResolvedValue(browser);
    await expect(renderBrowserPdf(binding, html, font)).resolves.toEqual(pdf);
    expect(continueRequest).toHaveBeenCalledOnce();
    expect(abortRequest).not.toHaveBeenCalled();
  });

  it("rejects oversized HTML and invalid page counts before launch", async () => {
    await expect(renderBrowserPdf(binding, html.repeat(10_000), font)).rejects.toThrow(
      /input/i,
    );
    await expect(
      renderBrowserPdf(
        binding,
        html.replace('class="sheet student"', 'class="invalid"'),
        font,
      ),
    ).rejects.toThrow(/pages/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it("aborts page requests and fails explicitly instead of producing a partial PDF", async () => {
    const { browser, page } = mockBrowser();
    const abort = vi.fn().mockResolvedValue(undefined);
    page.setContent.mockImplementationOnce(async () => {
      const listener = page.on.mock.calls.find(([event]) => event === "request")![1];
      listener({ abort, url: () => "https://example.invalid/resource" });
    });
    launch.mockResolvedValue(browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/network/i);
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(page.pdf).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("rejects font fallback and page overflow while releasing the browser", async () => {
    const fallback = mockBrowser();
    fallback.session.send.mockImplementation(async (method: string) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelectorAll") return { nodeIds: [2] };
      if (method === "CSS.getPlatformFontsForNode")
        return {
          fonts: [{ glyphCount: 1, isCustomFont: false, postScriptName: "Arial" }],
        };
      return {};
    });
    launch.mockResolvedValueOnce(fallback.browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/font/i);
    expect(fallback.browser.close).toHaveBeenCalledOnce();
    const overflow = mockBrowser();
    overflow.page.evaluate
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ pages: 1, overflow: true, clipped: false });
    launch.mockResolvedValueOnce(overflow.browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/layout/i);
    expect(overflow.browser.close).toHaveBeenCalledOnce();
  });

  it("rejects malformed PDF bytes and propagates browser-close failures", async () => {
    const invalid = mockBrowser();
    invalid.page.pdf.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    launch.mockResolvedValueOnce(invalid.browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/invalid PDF/i);
    const closeFailure = mockBrowser();
    closeFailure.browser.close.mockRejectedValueOnce(new Error("close failed"));
    launch.mockResolvedValueOnce(closeFailure.browser);
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/close failed/);
  });

  it("limits each isolate to one active render and frees the slot after acquisition failure", async () => {
    let rejectLaunch: (reason: Error) => void = () => {};
    launch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLaunch = reject;
        }),
    );
    const first = renderBrowserPdf(binding, html, font);
    const rejected = expect(first).rejects.toThrow(/quota exhausted/);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    await expect(renderBrowserPdf(binding, html, font)).rejects.toThrow(/busy/);
    rejectLaunch(new Error("quota exhausted"));
    await rejected;
    const next = mockBrowser();
    launch.mockResolvedValueOnce(next.browser);
    await expect(renderBrowserPdf(binding, html, font)).resolves.toEqual(pdf);
  });

  it("closes a timed-out browser and bounds the waiting time", async () => {
    vi.useFakeTimers();
    const { browser, page } = mockBrowser();
    page.setContent.mockImplementationOnce(() => new Promise(() => {}));
    launch.mockResolvedValueOnce(browser);
    const pending = renderBrowserPdf(binding, html, font);
    const rejected = expect(pending).rejects.toThrow(/time limit/);
    await vi.waitFor(() => expect(page.setContent).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes a browser even when acquisition resolves after the request deadline", async () => {
    vi.useFakeTimers();
    const { browser } = mockBrowser();
    let resolveLaunch: (value: unknown) => void = () => {};
    launch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLaunch = resolve;
        }),
    );
    const pending = renderBrowserPdf(binding, html, font);
    const rejected = expect(pending).rejects.toThrow(/time limit/);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    const wrappedBinding = launch.mock.calls[0]![0] as BrowserPdfBinding;
    expect(wrappedBinding).not.toBe(binding);
    resolveLaunch(browser);
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce());
    expect(browser.newPage).not.toHaveBeenCalled();
  });
});
