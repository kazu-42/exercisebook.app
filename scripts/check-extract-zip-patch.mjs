import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const patchedSha256 =
  "201b4bb33a337968f9474be0bafd6a0774cae419f7cf101e0f77b0ad181ae941";
const linkError = /Symbolic links are not supported by the hardened extractor/;

export function resolveInstalledExtractor() {
  const studioRequire = createRequire(path.join(root, "apps/studio/package.json"));
  const puppeteerRequire = createRequire(
    studioRequire.resolve("@cloudflare/puppeteer"),
  );
  const browsersRequire = createRequire(
    puppeteerRequire.resolve("@puppeteer/browsers"),
  );
  return { entry: browsersRequire.resolve("extract-zip"), require: browsersRequire };
}

// Stored ZIP fixtures avoid extra dependencies, network access, or executable tools.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;
  for (const { name, data = "", mode = 0o100644 } of entries) {
    const filename = Buffer.from(name);
    const content = Buffer.from(data);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localEntries.push(local, filename, content);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, filename);
    offset += local.length + filename.length + content.length;
  }
  const directory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, end]);
}

export async function verifyExtractionRegressions(extract) {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "exercisebook-extractzip-check-"),
  );
  const canary = path.join(temporary, "outside-canary.txt");
  const original = "outside file must remain unchanged";
  const checks = [];
  const run = async (name, test) => {
    // Run all attacks so a failing symlink check cannot mask a leaf-write defect.
    try {
      await test();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error });
    }
  };
  const fixture = async (name, entries) => {
    const archive = path.join(temporary, `${name}.zip`);
    const directory = path.join(temporary, name);
    await mkdir(directory);
    await writeFile(archive, zip(entries));
    return { archive, directory };
  };
  const absent = async (file) => {
    await assert.rejects(lstat(file), { code: "ENOENT" });
  };
  try {
    await run("ordinary nested files and directories", async () => {
      const { archive, directory } = await fixture("ordinary", [
        { name: "nested/", mode: 0o040755 },
        { name: "nested/hello.txt", data: "ordinary archive content" },
      ]);
      await extract(archive, { dir: directory });
      assert.equal(
        await readFile(path.join(directory, "nested/hello.txt"), "utf8"),
        "ordinary archive content",
      );
    });
    for (const [name, target] of [
      ["absolute-symlink", canary],
      ["relative-symlink", "../outside-canary.txt"],
      ["internal-symlink", "inside.txt"],
    ]) {
      await run(name, async () => {
        await writeFile(canary, original);
        const { archive, directory } = await fixture(name, [
          { name: "link", data: target, mode: 0o120777 },
        ]);
        await assert.rejects(extract(archive, { dir: directory }), linkError);
        await absent(path.join(directory, "link"));
        assert.equal(await readFile(canary, "utf8"), original);
      });
    }
    await run("archive symlink followed by same-name regular file", async () => {
      await writeFile(canary, original);
      const { archive, directory } = await fixture("duplicate-symlink", [
        { name: "link", data: "../outside-canary.txt", mode: 0o120777 },
        { name: "link", data: "malicious overwrite" },
      ]);
      await assert.rejects(extract(archive, { dir: directory }), linkError);
      assert.equal(await readFile(canary, "utf8"), original);
      await absent(path.join(directory, "link"));
    });
    for (const dangling of [false, true]) {
      const name = dangling ? "dangling-leaf-symlink" : "existing-leaf-symlink";
      await run(name, async () => {
        const target = dangling
          ? path.join(temporary, "must-not-be-created.txt")
          : canary;
        await writeFile(canary, original);
        const { archive, directory } = await fixture(name, [
          { name: "file.txt", data: "malicious overwrite" },
        ]);
        await symlink(target, path.join(directory, "file.txt"));
        await assert.rejects(extract(archive, { dir: directory }), { code: "EEXIST" });
        assert.equal(await readFile(canary, "utf8"), original);
        if (dangling) await absent(target);
      });
    }
    await run("duplicate regular paths preserve first content", async () => {
      const { archive, directory } = await fixture("duplicate-file", [
        { name: "file.txt", data: "first content" },
        { name: "file.txt", data: "replacement" },
      ]);
      await assert.rejects(extract(archive, { dir: directory }), { code: "EEXIST" });
      assert.equal(
        await readFile(path.join(directory, "file.txt"), "utf8"),
        "first content",
      );
    });
    const failures = checks.filter((check) => !check.passed);
    if (failures.length) {
      throw new AggregateError(
        failures.map(({ error }) => error),
        `extract-zip regression failures: ${failures.map(({ name }) => name).join(", ")}`,
      );
    }
    return checks.length;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyInstalledPatch() {
  const installed = resolveInstalledExtractor();
  const metadata = installed.require("extract-zip/package.json");
  assert.equal(
    metadata.version,
    "2.0.1",
    "Re-review the extractor patch when its version changes",
  );
  const digest = createHash("sha256")
    .update(await readFile(installed.entry))
    .digest("hex");
  assert.equal(
    digest,
    patchedSha256,
    "Installed extract-zip bytes do not match the reviewed patch; run pnpm install or re-review the patch before accepting advisory exceptions",
  );
  const checks = await verifyExtractionRegressions(installed.require("extract-zip"));
  return { checks, sha256: digest };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = await verifyInstalledPatch();
    console.log(
      `extract-zip 2.0.1: reviewed bytes verified; ${result.checks} extraction regressions passed`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
