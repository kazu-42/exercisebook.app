import { readFile, writeFile } from "node:fs/promises";

import { format, resolveConfig } from "prettier";
import { z, type ZodType } from "zod";

import {
  CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS,
  ContentDocumentV1Schema,
  WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS,
  WorksheetInstanceV1Schema,
} from "../src/index.js";

interface SchemaTarget {
  readonly fileUrl: URL;
  readonly id: string;
  readonly schema: ZodType;
  readonly runtimeInvariants: readonly string[];
}

const targets: readonly SchemaTarget[] = [
  {
    fileUrl: new URL("../json-schema/content-document-v1.schema.json", import.meta.url),
    id: "https://exercisebook.app/schemas/content-document-v1.schema.json",
    schema: ContentDocumentV1Schema,
    runtimeInvariants: CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS,
  },
  {
    fileUrl: new URL(
      "../json-schema/worksheet-instance-v1.schema.json",
      import.meta.url,
    ),
    id: "https://exercisebook.app/schemas/worksheet-instance-v1.schema.json",
    schema: WorksheetInstanceV1Schema,
    runtimeInvariants: WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS,
  },
];

const checkOnly = process.argv.includes("--check");
let foundDifference = false;

for (const target of targets) {
  const generated = {
    ...z.toJSONSchema(target.schema, {
      io: "output",
      reused: "ref",
      target: "draft-2020-12",
      unrepresentable: "throw",
    }),
    $id: target.id,
    "x-exercisebook-runtime-invariants": target.runtimeInvariants,
  };
  const filePath = target.fileUrl.pathname;
  const config = await resolveConfig(filePath);
  const serialized = await format(JSON.stringify(generated), {
    ...config,
    filepath: filePath,
  });

  if (checkOnly) {
    const committed = await readFile(target.fileUrl, "utf8");
    if (committed !== serialized) {
      foundDifference = true;
      console.error(`JSON Schema is stale: ${target.fileUrl.pathname}`);
    }
  } else {
    await writeFile(target.fileUrl, serialized, "utf8");
  }
}

if (foundDifference) {
  process.exitCode = 1;
}
