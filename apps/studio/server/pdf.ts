import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { GradeItem, PdfVariant, Workbook } from "../src/contracts.js";
import { renderPrintHtml } from "./print.js";

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;

/** Local-only adapter. A rendering failure leaves the workbook in memory unchanged. */
export async function renderPdf(
  workbook: Workbook,
  answers: readonly GradeItem[],
  variant: PdfVariant,
): Promise<Uint8Array> {
  const input = Buffer.from(renderPrintHtml(workbook, answers, variant), "utf8");
  if (input.byteLength > MAX_INPUT_BYTES)
    throw new Error("PDF input exceeds the local renderer limit.");
  if (activeRenders >= MAX_CONCURRENT_RENDERS)
    throw new Error("The local PDF renderer is busy. Please try again.");
  activeRenders += 1;
  try {
    return await runRenderer(input);
  } finally {
    activeRenders -= 1;
  }
}

function runRenderer(input: Buffer): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "uv",
      [
        "run",
        "--offline",
        "--no-project",
        "--with",
        "playwright==1.63.0",
        "python",
        fileURLToPath(new URL("../scripts/render-pdf.py", import.meta.url)),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: {
          PATH: process.env["PATH"],
          HOME: process.env["HOME"],
          TMPDIR: process.env["TMPDIR"],
          SYSTEMROOT: process.env["SYSTEMROOT"],
          PYTHONUTF8: "1",
        },
      },
    );
    let settled = false;
    let outputBytes = 0;
    let errorBytes = 0;
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    const stop = () => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          console.error("Could not stop the local PDF renderer.", error);
      }
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      reject(error);
    };
    const timeout = setTimeout(
      () =>
        fail(new Error("The local PDF renderer exceeded its 30 second time limit.")),
      RENDER_TIMEOUT_MS,
    );
    child.once("error", () =>
      fail(
        new Error(
          "The local PDF renderer could not start. Install uv and run the documented PDF setup.",
        ),
      ),
    );
    child.stdin.once("error", () =>
      fail(new Error("The local PDF renderer stopped before accepting the workbook.")),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES)
        fail(new Error("PDF output exceeds the local renderer limit."));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.byteLength;
      if (errorBytes > MAX_ERROR_BYTES)
        fail(new Error("The local PDF renderer exceeded its error output limit."));
      else errors.push(chunk);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const details = Buffer.concat(errors).toString("utf8").trim();
        fail(
          new Error(
            `Local PDF rendering failed. ${details || "Install the pinned Playwright browser using the documented PDF setup."}`,
          ),
        );
        return;
      }
      const pdf = Buffer.concat(output);
      if (pdf.byteLength < 100 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        fail(new Error("The local PDF renderer returned an invalid PDF."));
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(pdf);
    });
    child.stdin.end(input);
  });
}
