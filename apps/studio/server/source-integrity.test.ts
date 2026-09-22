import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { afterEach, describe, expect, it } from "vitest";
import { topics } from "./model";
import { materializeWorkbooks, releaseIdFor } from "./release-build";
import type {
  ReleaseAsset,
  ReleaseArtifact,
  ReleasedWorkbook,
} from "./release-contract";
import { verifyReleaseBuild, verifySourceRecords } from "./source-integrity";

const temporaryRoots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "studio-source-integrity-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "apps/studio/worker"), { recursive: true });
  const relative = "apps/studio/worker/app.ts";
  const content = "export const version = 1;\n";
  await writeFile(path.join(root, relative), content);
  const sources = [{ path: relative, sha256: await sha256Hex(content) }];
  return { root, relative, sources };
}

async function revision(sources: unknown): Promise<string> {
  return "a".repeat(40) + "+" + (await sha256Hex(canonicalizeJson(sources)));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("studio release source integrity", () => {
  it("accepts the exact captured source bytes and manifest digest", async () => {
    const { root, sources } = await fixture();
    await expect(
      verifySourceRecords(root, sources, await revision(sources)),
    ).resolves.toBeUndefined();
  });

  it("rejects source drift and reports only its relative path", async () => {
    const { root, relative, sources } = await fixture();
    await writeFile(path.join(root, relative), "PRIVATE_CONTENT_DO_NOT_PRINT");
    const check = verifySourceRecords(root, sources, await revision(sources));
    await expect(check).rejects.toThrow(relative);
    await expect(check).rejects.not.toThrow("PRIVATE_CONTENT_DO_NOT_PRINT");
  });

  it("rejects missing sources and tampered manifest identity", async () => {
    const { root, relative, sources } = await fixture();
    await expect(
      verifySourceRecords(root, sources, "a".repeat(40) + "+" + "0".repeat(64)),
    ).rejects.toThrow(/manifest digest/);
    await rm(path.join(root, relative));
    await expect(
      verifySourceRecords(root, sources, await revision(sources)),
    ).rejects.toThrow(relative);
  });

  it.each([
    "../outside.ts",
    "/outside.ts",
    "apps/../outside.ts",
    "apps//file.ts",
    "apps/./file.ts",
    "apps\\file.ts",
    "apps/file\u0000.ts",
  ])("rejects an unsafe source path: %s", async (relative) => {
    const { root } = await fixture();
    const sources = [{ path: relative, sha256: "a".repeat(64) }];
    await expect(
      verifySourceRecords(root, sources, await revision(sources)),
    ).rejects.toThrow(/source path/);
  });

  it("rejects duplicate paths, unsorted records, unknown fields, and invalid hashes", async () => {
    const { root, sources } = await fixture();
    for (const records of [
      [],
      [...sources, ...sources],
      [{ path: "z.ts", sha256: "a".repeat(64) }, ...sources],
      [{ ...sources[0], hidden: "unexpected" }],
      [{ ...sources[0], sha256: "not-a-hash" }],
    ]) {
      await expect(
        verifySourceRecords(root, records, await revision(records)),
      ).rejects.toThrow();
    }
  });

  it("rejects links even when their target has the expected bytes", async () => {
    const { root, relative, sources } = await fixture();
    const target = path.join(root, "target.ts");
    await writeFile(target, "export const version = 1;\n");
    await rm(path.join(root, relative));
    await symlink(target, path.join(root, relative));
    await expect(
      verifySourceRecords(root, sources, await revision(sources)),
    ).rejects.toThrow(/source path/);
  });

  it("verifies private catalog identity and all public bytes before accepting a build", async () => {
    const { root, sources } = await fixture();
    const releaseRoot = path.join(root, ".release");
    await mkdir(path.join(releaseRoot, "public/assets"), { recursive: true });
    await mkdir(path.join(releaseRoot, "public/artifacts"), { recursive: true });
    const assets: ReleaseAsset[] = [];
    for (const [relative, contentType, content] of [
      ["/index.html", "text/html", "<!doctype html><html lang=ja></html>"],
      ["/assets/index-abcd1234.js", "text/javascript", "export {};"],
      ["/assets/index-abcd1234.css", "text/css", "body { color: black; }"],
    ] as const) {
      const bytes = Buffer.from(content);
      await writeFile(path.join(releaseRoot, "public", relative), bytes);
      assets.push({
        path: relative,
        contentType,
        bytes: bytes.length,
        sha256: await sha256Hex(bytes),
      });
    }
    const workbooks: ReleasedWorkbook[] = [];
    for (const entry of await materializeWorkbooks([sources[0]!.sha256])) {
      const pdfs = {} as Record<"student" | "answers", ReleaseArtifact>;
      for (const variant of ["student", "answers"] as const) {
        const bytes = Buffer.from(`%PDF-1.7\n${entry.workbook.id}\n${variant}`);
        const sha256 = await sha256Hex(bytes);
        const relative = `/artifacts/${sha256}.pdf` as const;
        pdfs[variant] = { path: relative, sha256, bytes: bytes.length };
        await writeFile(path.join(releaseRoot, "public", relative), bytes);
      }
      workbooks.push({ ...entry, pdfs });
    }
    const sourceRevision = await revision(sources);
    const payload = {
      schemaVersion: "studio-release-v1" as const,
      sourceRevision,
      topics,
      workbooks,
      assets,
    };
    const catalog = { ...payload, releaseId: await releaseIdFor(payload) };
    const build = { sources, sourceRevision, releaseId: catalog.releaseId };
    await writeFile(path.join(releaseRoot, "build-record.json"), JSON.stringify(build));
    await writeFile(path.join(releaseRoot, "catalog.json"), JSON.stringify(catalog));
    await expect(verifyReleaseBuild(root, releaseRoot)).resolves.toEqual(catalog);

    const changed = structuredClone(catalog);
    changed.workbooks[0]!.answers[0]!.answer = "999";
    await writeFile(path.join(releaseRoot, "catalog.json"), JSON.stringify(changed));
    await expect(verifyReleaseBuild(root, releaseRoot)).rejects.toThrow(/catalog.json/);
    await writeFile(path.join(releaseRoot, "catalog.json"), JSON.stringify(catalog));

    await writeFile(
      path.join(releaseRoot, "build-record.json"),
      JSON.stringify({ ...build, releaseId: "wrong" }),
    );
    await expect(verifyReleaseBuild(root, releaseRoot)).rejects.toThrow(
      /build-record.json/,
    );
    await writeFile(path.join(releaseRoot, "build-record.json"), JSON.stringify(build));

    await writeFile(path.join(releaseRoot, "public/index.html"), "changed");
    await expect(verifyReleaseBuild(root, releaseRoot)).rejects.toThrow(
      /public\/index.html/,
    );
    await writeFile(
      path.join(releaseRoot, "public/index.html"),
      "<!doctype html><html lang=ja></html>",
    );
    const pdfPath = workbooks[0]!.pdfs.student.path;
    await writeFile(path.join(releaseRoot, "public", pdfPath), "%PDF-corrupted");
    await expect(verifyReleaseBuild(root, releaseRoot)).rejects.toThrow(pdfPath);
  });
});
