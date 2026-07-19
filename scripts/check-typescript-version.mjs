import { readFileSync } from "node:fs";

const packageUrl = new URL("../node_modules/typescript/package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packageUrl, "utf8"));
const version = String(packageJson.version);

if (!version.startsWith("7.")) {
  throw new Error(
    `Exercise Book requires TypeScript 7; workspace resolved ${version}.`,
  );
}

process.stdout.write(`TypeScript ${version}\n`);
