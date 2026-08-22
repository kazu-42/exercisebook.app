import { describe, expect, it } from "vitest";

import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { materializeFractionAdditionWorksheetFromContent } from "@exercisebook/generators";
import { DAY_ONE_PREVIEW_REGISTRY } from "@exercisebook/planner";

import { authorizePublishedWorksheetMaterialization } from "./authorized-publication.js";
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

async function draftMaterialization() {
  return materializeFractionAdditionWorksheetFromContent(RELEASE_CONTENT_DOCUMENT, {
    assignmentId: "preview-authorized-publication-test",
    localStudyDate: "2026-08-22",
    timeZone: "Asia/Tokyo",
    locale: "en",
    seed: "0123456789abcdef".repeat(4),
    seedSecretVersion: "public-preview-v1",
    requestedItemCount: 4,
    plan: { id: "preview-authorized-publication-test", version: 1 },
    policy: { id: "day-one-fraction-preview", version: 4 },
    skillGraph: { id: "phase-1-math", revision: 1 },
    selectionReasons: ["current-frontier"],
    excludedCanonicalAnswers: [
      { numerator: "1", denominator: "2" },
      { numerator: "1", denominator: "3" },
      { numerator: "5", denominator: "6" },
    ],
  });
}

async function authorization() {
  return createLaunchReleaseAuthorizer(LEARNING_NEW_LAUNCH_RELEASE_V1).authorize({
    contentDocument: RELEASE_CONTENT_DOCUMENT,
    registry: DAY_ONE_PREVIEW_REGISTRY,
  });
}

describe("authorized worksheet publication", () => {
  it("changes only the approved attribution status and re-seals the instance", async () => {
    const draft = await draftMaterialization();
    const published = await authorizePublishedWorksheetMaterialization({
      materialized: draft,
      authorization: await authorization(),
      contentDocument: RELEASE_CONTENT_DOCUMENT,
    });

    expect(draft.instance.attributions[0]?.publicationStatus).toBe("draft");
    expect(published.instance.attributions).toEqual([
      {
        ...draft.instance.attributions[0],
        publicationStatus: "published",
      },
    ]);
    expect({
      ...published.instance,
      attributions: draft.instance.attributions,
    }).toEqual(draft.instance);
    expect(published.canonicalJson).toBe(canonicalizeJson(published.instance));
    expect(published.instanceHash).toBe(await sha256Hex(published.canonicalJson));
    expect(published.instanceHash).not.toBe(draft.instanceHash);
  });

  it("rejects a tampered materialization envelope", async () => {
    const draft = await draftMaterialization();

    await expect(
      authorizePublishedWorksheetMaterialization({
        materialized: { ...draft, instanceHash: "0".repeat(64) },
        authorization: await authorization(),
        contentDocument: RELEASE_CONTENT_DOCUMENT,
      }),
    ).rejects.toThrow(/hash/iu);
  });

  it("rejects attribution drift even when the caller re-seals it", async () => {
    const draft = await draftMaterialization();
    const instance = structuredClone(draft.instance);
    instance.attributions[0]!.sourceUrl = "https://example.com/unapproved";
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      authorizePublishedWorksheetMaterialization({
        materialized: {
          instance,
          canonicalJson,
          instanceHash: await sha256Hex(canonicalJson),
        },
        authorization: await authorization(),
        contentDocument: RELEASE_CONTENT_DOCUMENT,
      }),
    ).rejects.toThrow(/attribution/iu);
  });

  it("rejects an authorization for a different content hash", async () => {
    const approved = await authorization();

    await expect(
      authorizePublishedWorksheetMaterialization({
        materialized: await draftMaterialization(),
        authorization: {
          ...approved,
          content: { ...approved.content, contentHash: "0".repeat(64) },
        },
        contentDocument: RELEASE_CONTENT_DOCUMENT,
      }),
    ).rejects.toThrow(/authorization/iu);
  });

  it.each([
    [
      "policy",
      (
        instance: Mutable<Awaited<ReturnType<typeof draftMaterialization>>["instance"]>,
      ) => {
        instance.policy.version += 1;
      },
    ],
    [
      "RNG",
      (
        instance: Mutable<Awaited<ReturnType<typeof draftMaterialization>>["instance"]>,
      ) => {
        instance.rng.seedSecretVersion = "unapproved-preview-v2";
      },
    ],
    [
      "generator",
      (
        instance: Mutable<Awaited<ReturnType<typeof draftMaterialization>>["instance"]>,
      ) => {
        (
          instance.slots[0]!.provenance as {
            generatorVersion: string;
          }
        ).generatorVersion = "2";
      },
    ],
  ] as const)("rejects re-sealed %s runtime drift", async (_label, mutate) => {
    const draft = await draftMaterialization();
    const instance = structuredClone(draft.instance) as Mutable<typeof draft.instance>;
    mutate(instance);
    const canonicalJson = canonicalizeJson(instance);

    await expect(
      authorizePublishedWorksheetMaterialization({
        materialized: {
          instance,
          canonicalJson,
          instanceHash: await sha256Hex(canonicalJson),
        },
        authorization: await authorization(),
        contentDocument: RELEASE_CONTENT_DOCUMENT,
      }),
    ).rejects.toThrow(/runtime|generatorVersion/iu);
  });
});
