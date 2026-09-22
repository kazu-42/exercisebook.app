import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { createWorkbook } from "./model.js";
import { renderPdf } from "./pdf.js";

class RendererProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = undefined;

  finish(bytes: Buffer, code = 0): void {
    this.stdout.write(bytes);
    this.emit("close", code);
  }
}

const workbook = createWorkbook({
  topicId: "equations",
  level: "foundation",
  count: 4,
});
const validPdf = Buffer.from(`%PDF-1.7\n${"x".repeat(100)}`);

describe("bounded local PDF process", () => {
  let children: RendererProcess[];

  beforeEach(() => {
    children = [];
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = new RendererProcess();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("pins the redistributable Japanese font bytes, license, attribution, and official source revision", () => {
    const base = new URL("../assets/fonts/noto-sans-jp/", import.meta.url);
    const font = readFileSync(new URL("NotoSansJP-wght.ttf", base));
    const license = readFileSync(new URL("OFL.txt", base));
    const metadata = JSON.parse(
      readFileSync(new URL("metadata.json", base), "utf8"),
    ) as Record<string, unknown>;
    expect(createHash("sha256").update(font).digest("hex")).toBe(
      "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
    );
    expect(metadata.sha256).toBe(createHash("sha256").update(font).digest("hex"));
    expect(metadata.bytes).toBe(font.byteLength);
    expect(metadata.licenseSha256).toBe(
      createHash("sha256").update(license).digest("hex"),
    );
    expect(metadata.license).toBe("OFL-1.1");
    expect(metadata.sourceUrl).toContain(
      `https://raw.githubusercontent.com/google/fonts/${metadata.sourceRevision}/`,
    );
    expect(license.toString("utf8")).toContain(String(metadata.attribution));
    expect(metadata.modifications).toMatch(/^None\./);
  });

  it("returns validated PDF bytes using an offline, pinned, shell-free process with no inherited credentials", async () => {
    vi.stubEnv("PRIVATE_RENDERER_TEST_TOKEN", "never-forward-this");
    const pending = renderPdf(workbook, [], "student");
    const [command, args, options] = spawnMock.mock.calls[0]!;
    expect(command).toBe("uv");
    expect(args).toContain("--offline");
    expect(args).toContain("playwright==1.63.0");
    expect(options.shell).toBeUndefined();
    expect(options.env.PRIVATE_RENDERER_TEST_TOKEN).toBeUndefined();
    const input = children[0]!.stdin.read().toString("utf8") as string;
    expect(input).toContain(workbook.items[0]!.prompt);
    children[0]!.finish(validPdf);
    expect(await pending).toEqual(validPdf);
  });

  it("rejects invalid PDF bytes and releases capacity after failure", async () => {
    const pending = renderPdf(workbook, [], "student");
    const rejected = expect(pending).rejects.toThrow(/invalid PDF/);
    children[0]!.finish(Buffer.from("not a PDF"));
    await rejected;
    const next = renderPdf(workbook, [], "student");
    children[1]!.finish(validPdf);
    await expect(next).resolves.toEqual(validPdf);
  });

  it("caps concurrency without starting a third renderer", async () => {
    const first = renderPdf(workbook, [], "student");
    const second = renderPdf(workbook, [], "student");
    await expect(renderPdf(workbook, [], "student")).rejects.toThrow(/busy/);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const child of children) child.finish(validPdf);
    await Promise.all([first, second]);
  });

  it("fails on timeout instead of leaving a request waiting indefinitely", async () => {
    vi.useFakeTimers();
    const pending = renderPdf(workbook, [], "student");
    const rejected = expect(pending).rejects.toThrow(/30 second time limit/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
  });

  it("reports process failure and bounds stderr and binary output", async () => {
    const unavailable = renderPdf(workbook, [], "student");
    const failure = expect(unavailable).rejects.toThrow(/browser unavailable/);
    children[0]!.stderr.write("browser unavailable");
    children[0]!.finish(Buffer.alloc(0), 1);
    await failure;

    const noisy = renderPdf(workbook, [], "student");
    const noiseFailure = expect(noisy).rejects.toThrow(/error output limit/);
    children[1]!.stderr.write(Buffer.alloc(16 * 1024 + 1));
    await noiseFailure;

    const large = renderPdf(workbook, [], "student");
    const sizeFailure = expect(large).rejects.toThrow(/output exceeds/);
    children[2]!.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1));
    await sizeFailure;
  });
});
