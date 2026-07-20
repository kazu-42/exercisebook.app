import path from "node:path";

import { findImportBoundaryViolations } from "./import-boundary-policy.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const violations = await findImportBoundaryViolations(repositoryRoot);
if (violations.length > 0) {
  console.error("Import boundary violations:");
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Import boundaries are intact.");
}
