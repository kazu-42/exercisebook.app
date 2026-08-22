import { describe, expect, it } from "vitest";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { DAY_ONE_PREVIEW_REGISTRY } from "@exercisebook/planner";

import {
  LEARNING_NEW_LAUNCH_RELEASE_V1,
  createLaunchReleaseAuthorizer,
} from "./launch-release-manifest.js";
import { RELEASE_CONTENT_DOCUMENT } from "./release-content.js";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends ReadonlyArray<infer Item>
    ? Mutable<Item>[]
    : T[Key] extends object
      ? Mutable<T[Key]>
      : T[Key];
};

function mutableManifest(): Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1> {
  return structuredClone(LEARNING_NEW_LAUNCH_RELEASE_V1) as Mutable<
    typeof LEARNING_NEW_LAUNCH_RELEASE_V1
  >;
}

describe("learning.new trusted launch release", () => {
  it("authorizes only the exact owner-approved content and runtime registry", async () => {
    const authorization = await createLaunchReleaseAuthorizer(
      LEARNING_NEW_LAUNCH_RELEASE_V1,
    ).authorize({
      contentDocument: RELEASE_CONTENT_DOCUMENT,
      registry: DAY_ONE_PREVIEW_REGISTRY,
    });

    expect(authorization).toEqual({
      releaseId: "learning-new-launch-2026-08-22",
      content: {
        id: "math.fractions.add-unlike-denominators",
        revision: 3,
        sourceHash: RELEASE_CONTENT_DOCUMENT.sourceHash,
        contentHash: LEARNING_NEW_LAUNCH_RELEASE_V1.content.contentHash,
        compilerVersion: "exercisebook-content-compiler/1",
      },
      publishedAttribution: {
        licenseId: "CC-BY-4.0",
        attributionText:
          "Add fractions with unlike denominators © 2026 Exercise Book contributors. Licensed under CC BY 4.0.",
        publicationStatus: "published",
      },
      runtime: {
        policy: { id: "day-one-fraction-preview", version: 4 },
        skillGraph: { id: "phase-1-math", revision: 1 },
        generator: { id: "fractions.add", version: "1" },
        rng: {
          algorithm: "xoshiro128ss-v1",
          seedVersion: "public-preview-v1",
        },
      },
    });
  });

  it("requires an explicit, exact, enabled manifest", () => {
    expect(() => createLaunchReleaseAuthorizer(undefined)).toThrow(
      /release manifest is required/iu,
    );
    expect(() => createLaunchReleaseAuthorizer(null)).toThrow();

    const withUnknownField = {
      ...LEARNING_NEW_LAUNCH_RELEASE_V1,
      latest: true,
    };
    expect(() => createLaunchReleaseAuthorizer(withUnknownField)).toThrow(
      /unsupported fields/iu,
    );

    const disabled = mutableManifest();
    disabled.enabled = false;
    expect(() => createLaunchReleaseAuthorizer(disabled)).toThrow(/disabled/iu);
  });

  it.each([
    [
      "draft license",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.content.licenseId = "LicenseRef-ExerciseBook-Draft";
      },
    ],
    [
      "wrong source hash",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.content.sourceHash = "0".repeat(64);
      },
    ],
    [
      "wrong content hash",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.content.contentHash = "0".repeat(64);
      },
    ],
    [
      "wrong policy",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.runtime.policy.version += 1;
      },
    ],
    [
      "wrong generator",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.runtime.generator.version = "2";
      },
    ],
    [
      "wrong RNG",
      (manifest: Mutable<typeof LEARNING_NEW_LAUNCH_RELEASE_V1>) => {
        manifest.runtime.rng.algorithm = "xoshiro128ss-v2";
      },
    ],
  ] as const)("rejects a %s manifest", async (_label, mutate) => {
    const manifest = mutableManifest();
    mutate(manifest);
    const authorizer = createLaunchReleaseAuthorizer(manifest);

    await expect(
      authorizer.authorize({
        contentDocument: RELEASE_CONTENT_DOCUMENT,
        registry: DAY_ONE_PREVIEW_REGISTRY,
      }),
    ).rejects.toThrow();
  });

  it("rejects content whose identity or approved license differs", async () => {
    const authorizer = createLaunchReleaseAuthorizer(LEARNING_NEW_LAUNCH_RELEASE_V1);

    await expect(
      authorizer.authorize({
        contentDocument: {
          ...RELEASE_CONTENT_DOCUMENT,
          revision: RELEASE_CONTENT_DOCUMENT.revision + 1,
        },
        registry: DAY_ONE_PREVIEW_REGISTRY,
      }),
    ).rejects.toThrow(/content/iu);

    await expect(
      authorizer.authorize({
        contentDocument: {
          ...RELEASE_CONTENT_DOCUMENT,
          license: {
            ...RELEASE_CONTENT_DOCUMENT.license,
            licenseId: "LicenseRef-ExerciseBook-Draft",
          },
        },
        registry: DAY_ONE_PREVIEW_REGISTRY,
      }),
    ).rejects.toThrow(/license/iu);
  });

  it("rejects runtime registry drift", async () => {
    const authorizer = createLaunchReleaseAuthorizer(LEARNING_NEW_LAUNCH_RELEASE_V1);

    await expect(
      authorizer.authorize({
        contentDocument: RELEASE_CONTENT_DOCUMENT,
        registry: {
          ...DAY_ONE_PREVIEW_REGISTRY,
          content: {
            ...DAY_ONE_PREVIEW_REGISTRY.content,
            reviewedItemCount: 7,
          },
        },
      }),
    ).rejects.toThrow(/registry/iu);
  });

  it("rejects an internally consistent alternative that the owner did not approve", async () => {
    const contentDocument = structuredClone(RELEASE_CONTENT_DOCUMENT) as Mutable<
      typeof RELEASE_CONTENT_DOCUMENT
    >;
    contentDocument.license.attributionText =
      "Unapproved alternative attribution under CC BY 4.0.";
    const manifest = mutableManifest();
    manifest.content.attributionText = contentDocument.license.attributionText;
    manifest.content.contentHash = await sha256Hex(canonicalizeJson(contentDocument));

    await expect(
      createLaunchReleaseAuthorizer(manifest).authorize({
        contentDocument,
        registry: DAY_ONE_PREVIEW_REGISTRY,
      }),
    ).rejects.toThrow(/owner-approved/iu);
  });

  it("detaches the validated authority from later caller mutation", async () => {
    const manifest = mutableManifest();
    const authorizer = createLaunchReleaseAuthorizer(manifest);
    manifest.enabled = false;
    manifest.content.licenseId = "LicenseRef-ExerciseBook-Draft";

    await expect(
      authorizer.authorize({
        contentDocument: RELEASE_CONTENT_DOCUMENT,
        registry: DAY_ONE_PREVIEW_REGISTRY,
      }),
    ).resolves.toMatchObject({
      releaseId: "learning-new-launch-2026-08-22",
      publishedAttribution: {
        licenseId: "CC-BY-4.0",
        publicationStatus: "published",
      },
    });
  });
});
