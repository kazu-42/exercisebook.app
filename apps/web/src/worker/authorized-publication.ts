import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  assertSafeDataObjectGraph,
  validateContentDocumentV1,
  validateWorksheetInstanceV1,
  type AttributionV1,
  type ContentDocumentV1,
  type MaterializedWorksheetInstanceV1,
} from "@exercisebook/schemas";

import type { LaunchReleaseAuthorizationV1 } from "./launch-release-manifest.js";

export async function authorizePublishedWorksheetMaterialization(input: {
  readonly materialized: MaterializedWorksheetInstanceV1;
  readonly authorization: LaunchReleaseAuthorizationV1;
  readonly contentDocument: ContentDocumentV1;
}): Promise<MaterializedWorksheetInstanceV1> {
  assertSafeDataObjectGraph(input);

  // Detach every caller-owned value before the first asynchronous yield. The
  // final publication decision and hash describe one stable snapshot.
  const instance = validateWorksheetInstanceV1(input.materialized.instance);
  const providedCanonicalJson = input.materialized.canonicalJson;
  const providedInstanceHash = input.materialized.instanceHash;
  const contentDocument = validateContentDocumentV1(input.contentDocument);
  const authorization = validateAuthorization(input.authorization);

  const canonicalJson = canonicalizeJson(instance);
  if (canonicalJson !== providedCanonicalJson) {
    throw new Error("Worksheet canonical JSON does not match the draft instance");
  }
  if ((await sha256Hex(canonicalJson)) !== providedInstanceHash) {
    throw new Error("Worksheet hash does not match the draft canonical JSON");
  }

  const contentHash = await sha256Hex(canonicalizeJson(contentDocument));
  assertAuthorizationMatchesContent(authorization, contentDocument, contentHash);

  if (
    instance.policy.id !== authorization.runtime.policy.id ||
    instance.policy.version !== authorization.runtime.policy.version ||
    instance.skillGraph.id !== authorization.runtime.skillGraph.id ||
    instance.skillGraph.revision !== authorization.runtime.skillGraph.revision ||
    instance.rng.algorithm !== authorization.runtime.rng.algorithm ||
    instance.rng.seedSecretVersion !== authorization.runtime.rng.seedVersion ||
    instance.slots.some(
      (slot) =>
        slot.provenance.generatorId !== authorization.runtime.generator.id ||
        slot.provenance.generatorVersion !== authorization.runtime.generator.version,
    )
  ) {
    throw new Error("Worksheet runtime does not match the release authorization");
  }

  const contentReference = instance.content[0];
  if (
    instance.content.length !== 1 ||
    contentReference === undefined ||
    contentReference.id !== authorization.content.id ||
    contentReference.revision !== authorization.content.revision ||
    contentReference.sourceHash !== authorization.content.sourceHash ||
    contentReference.contentHash !== authorization.content.contentHash ||
    contentReference.compilerVersion !== authorization.content.compilerVersion
  ) {
    throw new Error("Worksheet content does not match the release authorization");
  }

  const sourceAttribution = instance.attributions[0];
  const expectedAttribution = attributionFromContent(contentDocument);
  if (
    instance.attributions.length !== 1 ||
    sourceAttribution === undefined ||
    canonicalizeJson(sourceAttribution) !== canonicalizeJson(expectedAttribution)
  ) {
    throw new Error("Worksheet attribution does not match the authorized content");
  }

  const publishedInstance = validateWorksheetInstanceV1({
    ...instance,
    attributions: [
      {
        ...sourceAttribution,
        publicationStatus: authorization.publishedAttribution.publicationStatus,
      },
    ],
  });
  const publishedCanonicalJson = canonicalizeJson(publishedInstance);
  return {
    instance: publishedInstance,
    canonicalJson: publishedCanonicalJson,
    instanceHash: await sha256Hex(publishedCanonicalJson),
  };
}

function validateAuthorization(value: unknown): LaunchReleaseAuthorizationV1 {
  assertSafeDataObjectGraph(value);
  const authorization = exactRecord(value, "$authorization");
  assertExactKeys(
    authorization,
    ["releaseId", "content", "publishedAttribution", "runtime"],
    "$authorization",
  );
  const content = exactRecord(authorization.content, "$authorization.content");
  assertExactKeys(
    content,
    ["id", "revision", "sourceHash", "contentHash", "compilerVersion"],
    "$authorization.content",
  );
  const attribution = exactRecord(
    authorization.publishedAttribution,
    "$authorization.publishedAttribution",
  );
  assertExactKeys(
    attribution,
    ["licenseId", "attributionText", "publicationStatus"],
    "$authorization.publishedAttribution",
  );
  const runtime = exactRecord(authorization.runtime, "$authorization.runtime");
  assertExactKeys(
    runtime,
    ["policy", "skillGraph", "generator", "rng"],
    "$authorization.runtime",
  );
  const policy = exactRecord(runtime.policy, "$authorization.runtime.policy");
  assertExactKeys(policy, ["id", "version"], "$authorization.runtime.policy");
  const skillGraph = exactRecord(
    runtime.skillGraph,
    "$authorization.runtime.skillGraph",
  );
  assertExactKeys(skillGraph, ["id", "revision"], "$authorization.runtime.skillGraph");
  const generator = exactRecord(runtime.generator, "$authorization.runtime.generator");
  assertExactKeys(generator, ["id", "version"], "$authorization.runtime.generator");
  const rng = exactRecord(runtime.rng, "$authorization.runtime.rng");
  assertExactKeys(rng, ["algorithm", "seedVersion"], "$authorization.runtime.rng");
  if (
    authorization.releaseId !== "learning-new-launch-2026-08-22" ||
    typeof content.id !== "string" ||
    !Number.isInteger(content.revision) ||
    typeof content.sourceHash !== "string" ||
    typeof content.contentHash !== "string" ||
    content.compilerVersion !== "exercisebook-content-compiler/1" ||
    typeof attribution.licenseId !== "string" ||
    typeof attribution.attributionText !== "string" ||
    attribution.publicationStatus !== "published" ||
    policy.id !== "day-one-fraction-preview" ||
    policy.version !== 4 ||
    skillGraph.id !== "phase-1-math" ||
    skillGraph.revision !== 1 ||
    generator.id !== "fractions.add" ||
    generator.version !== "1" ||
    rng.algorithm !== "xoshiro128ss-v1" ||
    rng.seedVersion !== "public-preview-v1"
  ) {
    throw new TypeError("Release authorization is invalid");
  }
  return structuredClone(value) as LaunchReleaseAuthorizationV1;
}

function assertAuthorizationMatchesContent(
  authorization: LaunchReleaseAuthorizationV1,
  content: ContentDocumentV1,
  contentHash: string,
): void {
  if (
    authorization.content.id !== content.id ||
    authorization.content.revision !== content.revision ||
    authorization.content.sourceHash !== content.sourceHash ||
    authorization.content.contentHash !== contentHash ||
    authorization.content.compilerVersion !== content.compilerVersion ||
    authorization.publishedAttribution.licenseId !== content.license.licenseId ||
    authorization.publishedAttribution.attributionText !==
      content.license.attributionText ||
    content.publication.status !== "draft"
  ) {
    throw new Error("Release authorization does not match the content document");
  }
}

function attributionFromContent(content: ContentDocumentV1): AttributionV1 {
  return {
    title: content.title,
    author: content.authors.map((author) => author.name).join(", "),
    sourceUrl: content.license.sourceUrl,
    licenseId: content.license.licenseId,
    attributionText: content.license.attributionText,
    publicationStatus: "draft",
    modifications: [],
  };
}

function exactRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${path} has unsupported fields`);
  }
}
