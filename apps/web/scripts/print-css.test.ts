import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererStylesPath = fileURLToPath(
  new URL("../../../packages/web-renderer/src/styles.css", import.meta.url),
);
const appStylesPath = fileURLToPath(
  new URL("../src/react-app/styles.css", import.meta.url),
);

describe("worksheet print CSS", () => {
  it("declares an A4 paper contract for browser printing", async () => {
    const styles = await readFile(rendererStylesPath, "utf8");

    expect(styles).toMatch(/@page\s*{[^}]*size:\s*A4 portrait;[^}]*}/s);
    expect(styles).toMatch(/@page\s*{[^}]*margin:\s*12mm;[^}]*}/s);
  });

  it("keeps navigation off paper and the worksheet footer together", async () => {
    const [rendererStyles, appStyles] = await Promise.all([
      readFile(rendererStylesPath, "utf8"),
      readFile(appStylesPath, "utf8"),
    ]);

    expect(appStyles).toMatch(/@media print\s*{.*\.skip-link,[^}]*display:\s*none;/s);
    expect(rendererStyles).toMatch(
      /@media print\s*{.*\.worksheet__footer\s*{[^}]*break-inside:\s*avoid;/s,
    );
  });
});
