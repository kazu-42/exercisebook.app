import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  PUBLIC_PREVIEW_SEED_VERSION_V1,
  validateDailyPlanPreviewRegistryV1,
  type DailyPlanPreviewRegistryV1,
} from "@exercisebook/planner";
import {
  RNG_ALGORITHM_V1,
  assertSafeDataObjectGraph,
  validateContentDocumentV1,
  type ContentDocumentV1,
} from "@exercisebook/schemas";

const RELEASE_MANIFEST_SCHEMA = "exercisebook.launch-release/v1";
const APPROVED_RELEASE_ID = "learning-new-launch-2026-08-22";
const APPROVED_AUTHORITY = "repository-owner";
const APPROVED_ON = "2026-08-22";
const APPROVED_SCOPE = "english-one-lesson-anonymous-unsaved-v1-preview";
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export interface LearningNewLaunchReleaseManifestV1 {
  readonly schema: string;
  readonly releaseId: string;
  readonly enabled: boolean;
  readonly approval: Readonly<{
    authority: string;
    approvedOn: string;
    scope: string;
  }>;
  readonly content: Readonly<{
    schema: string;
    id: string;
    revision: number;
    sourceHash: string;
    contentHash: string;
    compilerVersion: string;
    licenseId: string;
    attributionText: string;
    sourcePublicationStatus: string;
    publicPublicationStatus: string;
  }>;
  readonly runtime: Readonly<{
    registrySchema: string;
    policy: Readonly<{ id: string; version: number }>;
    skillGraph: Readonly<{ id: string; revision: number }>;
    content: Readonly<{
      id: string;
      revision: number;
      reviewedItemCount: number;
    }>;
    generator: Readonly<{ id: string; version: string }>;
    rng: Readonly<{ algorithm: string; seedVersion: string }>;
  }>;
}

export interface LaunchReleaseAuthorizationV1 {
  readonly releaseId: string;
  readonly content: Readonly<{
    id: string;
    revision: number;
    sourceHash: string;
    contentHash: string;
    compilerVersion: "exercisebook-content-compiler/1";
  }>;
  readonly publishedAttribution: Readonly<{
    licenseId: string;
    attributionText: string;
    publicationStatus: "published";
  }>;
  readonly runtime: Readonly<{
    policy: Readonly<{ id: string; version: number }>;
    skillGraph: Readonly<{ id: string; revision: number }>;
    generator: Readonly<{ id: string; version: string }>;
    rng: Readonly<{ algorithm: string; seedVersion: string }>;
  }>;
}

export interface LaunchReleaseAuthorizer {
  authorize(input: {
    readonly contentDocument: ContentDocumentV1;
    readonly registry: DailyPlanPreviewRegistryV1;
  }): Promise<LaunchReleaseAuthorizationV1>;
}

export const LEARNING_NEW_LAUNCH_RELEASE_V1: LearningNewLaunchReleaseManifestV1 =
  Object.freeze({
    schema: RELEASE_MANIFEST_SCHEMA,
    releaseId: APPROVED_RELEASE_ID,
    enabled: true,
    approval: Object.freeze({
      authority: APPROVED_AUTHORITY,
      approvedOn: APPROVED_ON,
      scope: APPROVED_SCOPE,
    }),
    content: Object.freeze({
      schema: "exercisebook.content-ast/v1",
      id: "math.fractions.add-unlike-denominators",
      revision: 3,
      sourceHash: "9654184d51610bbbdd82ce6b3d0f33de0addb51bc0427c99ef4ecc62a1983047",
      contentHash: "5b852e6db8ac41e9ab632365b362e3408c9ace58a6f87c7ad9965727e2b28a85",
      compilerVersion: "exercisebook-content-compiler/1",
      licenseId: "CC-BY-4.0",
      attributionText:
        "Add fractions with unlike denominators © 2026 Exercise Book contributors. Licensed under CC BY 4.0.",
      sourcePublicationStatus: "draft",
      publicPublicationStatus: "published",
    }),
    runtime: Object.freeze({
      registrySchema: "exercisebook.daily-plan-preview-registry/v1",
      policy: Object.freeze({
        id: "day-one-fraction-preview",
        version: 4,
      }),
      skillGraph: Object.freeze({ id: "phase-1-math", revision: 1 }),
      content: Object.freeze({
        id: "math.fractions.add-unlike-denominators",
        revision: 3,
        reviewedItemCount: 8,
      }),
      generator: Object.freeze({ id: "fractions.add", version: "1" }),
      rng: Object.freeze({
        algorithm: RNG_ALGORITHM_V1,
        seedVersion: PUBLIC_PREVIEW_SEED_VERSION_V1,
      }),
    }),
  });

export function createLaunchReleaseAuthorizer(
  manifestValue: unknown,
): LaunchReleaseAuthorizer {
  const manifest = validateReleaseManifest(manifestValue);

  return {
    async authorize({ contentDocument: contentValue, registry: registryValue }) {
      const content = validateContentDocumentV1(contentValue);
      const registry = validateDailyPlanPreviewRegistryV1(registryValue);
      assertApprovedReleaseIdentity(manifest);
      assertContentMatchesManifest(content, manifest);
      await assertContentHashMatchesManifest(content, manifest);
      assertRegistryMatchesManifest(registry, manifest);

      return {
        releaseId: manifest.releaseId,
        content: {
          id: content.id,
          revision: content.revision,
          sourceHash: content.sourceHash,
          contentHash: manifest.content.contentHash,
          compilerVersion: "exercisebook-content-compiler/1",
        },
        publishedAttribution: {
          licenseId: manifest.content.licenseId,
          attributionText: manifest.content.attributionText,
          publicationStatus: "published",
        },
        runtime: {
          policy: { ...manifest.runtime.policy },
          skillGraph: { ...manifest.runtime.skillGraph },
          generator: { ...manifest.runtime.generator },
          rng: { ...manifest.runtime.rng },
        },
      };
    },
  };
}

function validateReleaseManifest(value: unknown): LearningNewLaunchReleaseManifestV1 {
  if (value === undefined) {
    throw new TypeError("A release manifest is required");
  }
  assertSafeDataObjectGraph(value);
  const manifest = exactRecord(value, "$releaseManifest");
  assertExactKeys(
    manifest,
    ["schema", "releaseId", "enabled", "approval", "content", "runtime"],
    "$releaseManifest",
  );
  if (manifest.enabled !== true) {
    throw new TypeError("The release manifest is disabled");
  }

  const approval = exactRecord(manifest.approval, "$releaseManifest.approval");
  assertExactKeys(
    approval,
    ["authority", "approvedOn", "scope"],
    "$releaseManifest.approval",
  );
  const content = exactRecord(manifest.content, "$releaseManifest.content");
  assertExactKeys(
    content,
    [
      "schema",
      "id",
      "revision",
      "sourceHash",
      "contentHash",
      "compilerVersion",
      "licenseId",
      "attributionText",
      "sourcePublicationStatus",
      "publicPublicationStatus",
    ],
    "$releaseManifest.content",
  );
  const runtime = exactRecord(manifest.runtime, "$releaseManifest.runtime");
  assertExactKeys(
    runtime,
    ["registrySchema", "policy", "skillGraph", "content", "generator", "rng"],
    "$releaseManifest.runtime",
  );
  const policy = exactRecord(runtime.policy, "$releaseManifest.runtime.policy");
  assertExactKeys(policy, ["id", "version"], "$releaseManifest.runtime.policy");
  const skillGraph = exactRecord(
    runtime.skillGraph,
    "$releaseManifest.runtime.skillGraph",
  );
  assertExactKeys(
    skillGraph,
    ["id", "revision"],
    "$releaseManifest.runtime.skillGraph",
  );
  const runtimeContent = exactRecord(
    runtime.content,
    "$releaseManifest.runtime.content",
  );
  assertExactKeys(
    runtimeContent,
    ["id", "revision", "reviewedItemCount"],
    "$releaseManifest.runtime.content",
  );
  const generator = exactRecord(
    runtime.generator,
    "$releaseManifest.runtime.generator",
  );
  assertExactKeys(generator, ["id", "version"], "$releaseManifest.runtime.generator");
  const rng = exactRecord(runtime.rng, "$releaseManifest.runtime.rng");
  assertExactKeys(rng, ["algorithm", "seedVersion"], "$releaseManifest.runtime.rng");

  for (const [path, candidate] of [
    ["schema", manifest.schema],
    ["releaseId", manifest.releaseId],
    ["approval.authority", approval.authority],
    ["approval.approvedOn", approval.approvedOn],
    ["approval.scope", approval.scope],
    ["content.schema", content.schema],
    ["content.id", content.id],
    ["content.sourceHash", content.sourceHash],
    ["content.contentHash", content.contentHash],
    ["content.compilerVersion", content.compilerVersion],
    ["content.licenseId", content.licenseId],
    ["content.attributionText", content.attributionText],
    ["content.sourcePublicationStatus", content.sourcePublicationStatus],
    ["content.publicPublicationStatus", content.publicPublicationStatus],
    ["runtime.registrySchema", runtime.registrySchema],
    ["runtime.policy.id", policy.id],
    ["runtime.skillGraph.id", skillGraph.id],
    ["runtime.content.id", runtimeContent.id],
    ["runtime.generator.id", generator.id],
    ["runtime.generator.version", generator.version],
    ["runtime.rng.algorithm", rng.algorithm],
    ["runtime.rng.seedVersion", rng.seedVersion],
  ] as const) {
    assertNonEmptyString(candidate, `$releaseManifest.${path}`);
  }
  assertPositiveInteger(content.revision, "$releaseManifest.content.revision");
  assertPositiveInteger(policy.version, "$releaseManifest.runtime.policy.version");
  assertPositiveInteger(
    skillGraph.revision,
    "$releaseManifest.runtime.skillGraph.revision",
  );
  assertPositiveInteger(
    runtimeContent.revision,
    "$releaseManifest.runtime.content.revision",
  );
  assertPositiveInteger(
    runtimeContent.reviewedItemCount,
    "$releaseManifest.runtime.content.reviewedItemCount",
  );
  if (!SHA256_HEX.test(String(content.sourceHash))) {
    throw new TypeError("$releaseManifest.content.sourceHash must be SHA-256 hex");
  }
  if (!SHA256_HEX.test(String(content.contentHash))) {
    throw new TypeError("$releaseManifest.content.contentHash must be SHA-256 hex");
  }

  return structuredClone(value) as LearningNewLaunchReleaseManifestV1;
}

function assertApprovedReleaseIdentity(
  manifest: LearningNewLaunchReleaseManifestV1,
): void {
  if (canonicalizeJson(manifest) !== canonicalizeJson(LEARNING_NEW_LAUNCH_RELEASE_V1)) {
    throw new Error("Release manifest does not match the owner-approved launch");
  }
}

function assertContentMatchesManifest(
  content: ContentDocumentV1,
  manifest: LearningNewLaunchReleaseManifestV1,
): void {
  if (
    content.schema !== manifest.content.schema ||
    content.id !== manifest.content.id ||
    content.revision !== manifest.content.revision ||
    content.sourceHash !== manifest.content.sourceHash ||
    content.compilerVersion !== manifest.content.compilerVersion
  ) {
    throw new Error("Content does not match the approved release manifest");
  }
  if (
    content.license.licenseId !== manifest.content.licenseId ||
    content.license.attributionText !== manifest.content.attributionText
  ) {
    throw new Error("Content license does not match the approved release manifest");
  }
  if (content.publication.status !== manifest.content.sourcePublicationStatus) {
    throw new Error("Content publication status does not match the release manifest");
  }
}

async function assertContentHashMatchesManifest(
  content: ContentDocumentV1,
  manifest: LearningNewLaunchReleaseManifestV1,
): Promise<void> {
  const actualHash = await sha256Hex(canonicalizeJson(content));
  if (actualHash !== manifest.content.contentHash) {
    throw new Error("Content hash does not match the approved release manifest");
  }
}

function assertRegistryMatchesManifest(
  registry: DailyPlanPreviewRegistryV1,
  manifest: LearningNewLaunchReleaseManifestV1,
): void {
  const runtime = manifest.runtime;
  if (
    registry.schema !== runtime.registrySchema ||
    registry.policy.id !== runtime.policy.id ||
    registry.policy.version !== runtime.policy.version ||
    registry.policy.enabled !== true ||
    registry.skillGraph.id !== runtime.skillGraph.id ||
    registry.skillGraph.revision !== runtime.skillGraph.revision ||
    registry.skillGraph.enabled !== true ||
    registry.content.id !== runtime.content.id ||
    registry.content.revision !== runtime.content.revision ||
    registry.content.reviewedItemCount !== runtime.content.reviewedItemCount ||
    registry.content.enabled !== true ||
    registry.generator.id !== runtime.generator.id ||
    registry.generator.version !== runtime.generator.version ||
    registry.generator.enabled !== true
  ) {
    throw new Error("Runtime registry does not match the approved release manifest");
  }
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

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new TypeError(`${path} must be a non-empty bounded string`);
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${path} must be a positive integer`);
  }
}
