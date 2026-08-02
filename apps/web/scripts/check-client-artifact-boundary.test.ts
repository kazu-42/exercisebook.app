import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FORBIDDEN_CLIENT_ARTIFACT_TOKENS,
  scanClientArtifactBoundary,
} from "./check-client-artifact-boundary.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createClientOutput(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "exercisebook-client-boundary-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("client artifact boundary", () => {
  it("keeps every reviewed private worksheet field in the forbidden set", () => {
    expect(FORBIDDEN_CLIENT_ARTIFACT_TOKENS).toEqual(
      expect.arrayContaining([
        "baseSeed",
        "canonicalAnswer",
        "excludedCanonicalAnswers",
        "scoringRule",
        "seedSecretVersion",
        "seedVersion",
        "slotSeed",
        "solutionTrace",
      ]),
    );
  });

  it("accepts a bounded client output without server-only worksheet authority", async () => {
    const directory = await createClientOutput();
    await mkdir(join(directory, "assets"));
    await writeFile(
      join(directory, "assets", "index.js"),
      'const schema = "web-worksheet.v2";\n',
      "utf8",
    );

    await expect(scanClientArtifactBoundary(directory)).resolves.toEqual({
      filesScanned: 1,
      javascriptFiles: 1,
      totalBytes: 35,
    });
  });

  it.each(FORBIDDEN_CLIENT_ARTIFACT_TOKENS)(
    "rejects the server-only token %s",
    async (forbiddenToken) => {
      const directory = await createClientOutput();
      await writeFile(
        join(directory, "index.js"),
        `const leaked = ${JSON.stringify(forbiddenToken)};\n`,
        "utf8",
      );

      await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(
        forbiddenToken,
      );
    },
  );

  it("rejects server-only tokens in emitted non-JavaScript assets", async () => {
    const directory = await createClientOutput();
    await writeFile(join(directory, "index.js"), "export {};\n", "utf8");
    await writeFile(
      join(directory, "styles.css"),
      ".canonicalAnswer { display: none; }\n",
      "utf8",
    );

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(
      /canonicalAnswer/u,
    );
  });

  it("fails closed when the client output is missing or has no JavaScript", async () => {
    const missing = join(tmpdir(), `exercisebook-missing-${crypto.randomUUID()}`);
    await expect(scanClientArtifactBoundary(missing)).rejects.toThrow(
      /client artifact directory/u,
    );

    const empty = await createClientOutput();
    await writeFile(join(empty, "index.html"), "<main>Exercise Book</main>\n", "utf8");
    await expect(scanClientArtifactBoundary(empty)).rejects.toThrow(
      /JavaScript artifact/u,
    );
  });

  it("rejects symlinks instead of scanning outside the build root", async () => {
    const directory = await createClientOutput();
    const outside = await createClientOutput();
    await writeFile(join(outside, "outside.js"), "export {};\n", "utf8");
    await symlink(outside, join(directory, "assets"));

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(/symlink/u);
  });

  it("rejects an oversized artifact before accepting the output", async () => {
    const directory = await createClientOutput();
    const artifact = join(directory, "index.js");
    await writeFile(artifact, "export {};\n", "utf8");
    await truncate(artifact, 20 * 1_024 * 1_024 + 1);

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(
      /scanned bytes/u,
    );
  });

  it("bounds the total output entry count across every file extension", async () => {
    const directory = await createClientOutput();
    await writeFile(join(directory, "index.js"), "export {};\n", "utf8");
    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        writeFile(join(directory, `asset-${String(index)}.unknown`), "", "utf8"),
      ),
    );

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(
      /scanned entries/u,
    );
  });

  it("bounds directory fanout before accepting an empty output tree", async () => {
    const directory = await createClientOutput();
    await Promise.all(
      Array.from({ length: 1_001 }, (_, index) =>
        mkdir(join(directory, `directory-${String(index)}`)),
      ),
    );

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(
      /scanned entries/u,
    );
  });

  it("bounds nested output depth", async () => {
    const directory = await createClientOutput();
    let nested = directory;
    for (let depth = 0; depth < 17; depth += 1) {
      nested = join(nested, `d${String(depth)}`);
      await mkdir(nested);
    }
    await writeFile(join(nested, "index.js"), "export {};\n", "utf8");

    await expect(scanClientArtifactBoundary(directory)).rejects.toThrow(/depth/u);
  });
});
