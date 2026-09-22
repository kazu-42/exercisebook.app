import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateWorkbook,
  verifyGeneratedWorkbook,
  type GeneratedWorkbookSnapshot,
} from "../domain/generator";
import { topics } from "../server/model";
import {
  GeneratedWorkbookStore,
  GeneratedStorageError,
  IdempotencyConflictError,
  RENDER_LEASE_MS,
  type D1Result,
  type D1Statement,
  type GeneratedDatabase,
  type GeneratedRequestIdentity,
  type RenderClaim,
  type RenderIdentity,
} from "./generated-store";

class SqliteStatement implements D1Statement {
  readonly sql: string;
  readonly db: DatabaseSync;
  readonly values: readonly (string | number | null)[];
  constructor(
    db: DatabaseSync,
    sql: string,
    values: readonly (string | number | null)[] = [],
  ) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: readonly (string | number | null)[]): D1Statement {
    return new SqliteStatement(this.db, this.sql, values);
  }
  execute<Row>(): D1Result<Row> {
    return {
      success: true,
      results: this.db.prepare(this.sql).all(...this.values) as Row[],
    };
  }
  async all<Row>(): Promise<D1Result<Row>> {
    return this.execute<Row>();
  }
}

/** Real SQLite SQL/constraints, matching D1's atomic batch semantics. */
class SqliteDatabase implements GeneratedDatabase {
  readonly sqlite = new DatabaseSync(":memory:");
  failBatchAt: number | undefined;
  loseResponse = false;
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(
      readFileSync(
        new URL("./migrations/0001_generated_workbooks.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  prepare(sql: string): D1Statement {
    return new SqliteStatement(this.sqlite, sql);
  }
  async batch<Row>(statements: D1Statement[]): Promise<D1Result<Row>[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    const result: D1Result<Row>[] = [];
    try {
      for (const [index, statement] of statements.entries()) {
        if (this.failBatchAt === index) throw new Error("Simulated D1 failure");
        result.push((statement as SqliteStatement).execute<Row>());
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("Response lost after commit");
    }
    return result;
  }
  count(
    table: "generated_instances" | "generated_requests" | "generated_render_jobs",
  ): number {
    return Number(
      this.sqlite.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total,
    );
  }
}

let database: SqliteDatabase;
let store: GeneratedWorkbookStore;
let snapshot: GeneratedWorkbookSnapshot;
let identity: GeneratedRequestIdentity;
beforeEach(async () => {
  database = new SqliteDatabase();
  store = new GeneratedWorkbookStore(database);
  snapshot = await generateWorkbook(
    { topicId: "equations", level: "standard", count: 8 },
    "1".repeat(64),
    topics,
    "source-v1",
  );
  identity = {
    keyHash: await sha256Hex("opaque-key"),
    requestHash: await sha256Hex("equations/standard/8"),
    releaseId: "release-v1",
  };
});
afterEach(() => database.sqlite.close());

async function renderIdentity(
  variant: "student" | "answers" = "student",
): Promise<RenderIdentity> {
  const rendererSpec = canonicalizeJson({
    renderer: "browser-v1",
    printDocumentHash: "2".repeat(64),
    fontHash: "3".repeat(64),
  });
  const base = { instanceId: snapshot.workbook.id, variant, rendererSpec };
  return { ...base, renderSpecHash: await sha256Hex(canonicalizeJson(base)) };
}

async function claim(now = 1000, token = "claim-owner-first"): Promise<RenderClaim> {
  const result = await store.claimRender(await renderIdentity(), now, token);
  if (result.status !== "claimed") throw new Error("Expected claim");
  return result.claim;
}

describe("immutable generated snapshot storage", () => {
  it("persists exact verified snapshots before returning, and reloads after adapter restart", async () => {
    expect(await store.lookupRequest(identity)).toBeUndefined();
    expect(await store.load(snapshot.workbook.id)).toBeUndefined();
    expect(await store.create(identity, snapshot)).toEqual(snapshot);
    expect(
      await new GeneratedWorkbookStore(database).load(snapshot.workbook.id),
    ).toEqual(snapshot);
    expect(database.count("generated_instances")).toBe(1);
    expect(database.count("generated_requests")).toBe(1);
    expect(
      database.sqlite.prepare("SELECT key_hash FROM generated_requests").get()
        ?.key_hash,
    ).toBe(identity.keyHash);
  });

  it("replays the original snapshot across deployment/source changes without rebinding", async () => {
    await store.create(identity, snapshot);
    const newIdentity = { ...identity, releaseId: "release-v2" };
    expect(await store.lookupRequest(newIdentity)).toEqual(snapshot);
    const replacement = await generateWorkbook(
      { topicId: "equations", level: "standard", count: 8 },
      "2".repeat(64),
      topics,
      "source-v2",
    );
    expect(await store.create(newIdentity, replacement)).toEqual(snapshot);
    expect(database.count("generated_instances")).toBe(1);
    expect(
      database.sqlite.prepare("SELECT release_id FROM generated_requests").get()
        ?.release_id,
    ).toBe("release-v1");
  });

  it("returns one winning snapshot for concurrent same-key same-payload creates without orphans", async () => {
    const alternative = await generateWorkbook(
      { topicId: "equations", level: "standard", count: 8 },
      "2".repeat(64),
      topics,
      "source-v1",
    );
    const result = await Promise.all([
      store.create(identity, snapshot),
      store.create(identity, alternative),
    ]);
    expect(result[0]).toEqual(result[1]);
    expect(database.count("generated_instances")).toBe(1);
    expect(database.count("generated_requests")).toBe(1);
  });

  it("rejects different-payload key races without inserting the losing instance", async () => {
    const alternative = await generateWorkbook(
      { topicId: "expressions", level: "foundation", count: 4 },
      "2".repeat(64),
      topics,
      "source-v1",
    );
    const different = {
      ...identity,
      requestHash: await sha256Hex("expressions/foundation/4"),
    };
    const results = await Promise.allSettled([
      store.create(identity, snapshot),
      store.create(different, alternative),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(database.count("generated_instances")).toBe(1);
    expect(database.count("generated_requests")).toBe(1);
  });

  it("deduplicates exact content for independent request keys", async () => {
    await store.create(identity, snapshot);
    await store.create({ ...identity, keyHash: "a".repeat(64) }, snapshot);
    expect(database.count("generated_instances")).toBe(1);
    expect(database.count("generated_requests")).toBe(2);
  });

  it("captures snapshot and request inputs before asynchronous hash verification", async () => {
    const original = structuredClone(snapshot);
    const mutableIdentity = { ...identity };
    const creating = store.create(mutableIdentity, snapshot);
    snapshot.workbook.title = "changed by the caller during validation";
    mutableIdentity.requestHash = "f".repeat(64);
    expect(await creating).toEqual(original);
    expect(await store.lookupRequest(identity)).toEqual(original);
  });

  it("rolls back failures between instance insertion and request binding", async () => {
    database.failBatchAt = 1;
    await expect(store.create(identity, snapshot)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    expect(database.count("generated_instances")).toBe(0);
    expect(database.count("generated_requests")).toBe(0);
    database.failBatchAt = undefined;
    expect(await store.create(identity, snapshot)).toEqual(snapshot);
  });

  it("recovers a committed request after its response is lost", async () => {
    database.loseResponse = true;
    await expect(store.create(identity, snapshot)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    expect(await store.lookupRequest(identity)).toEqual(snapshot);
    expect(await store.create(identity, snapshot)).toEqual(snapshot);
    expect(database.count("generated_instances")).toBe(1);
  });

  it("rejects corrupted JSON, recalculated storage hashes, and mismatched row relations", async () => {
    await store.create(identity, snapshot);
    const invalid = structuredClone(snapshot);
    invalid.workbook.title = "corrupted but with a matching storage checksum";
    const json = canonicalizeJson(invalid);
    database.sqlite
      .prepare("UPDATE generated_instances SET snapshot_json = ?, snapshot_hash = ?")
      .run(json, await sha256Hex(json));
    await expect(store.load(snapshot.workbook.id)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    await expect(store.lookupRequest(identity)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    database.sqlite
      .prepare(
        "UPDATE generated_instances SET snapshot_json = ?, snapshot_hash = ?, instance_hash = ?",
      )
      .run(
        canonicalizeJson(snapshot),
        await sha256Hex(canonicalizeJson(snapshot)),
        "a".repeat(64),
      );
    await expect(store.load(snapshot.workbook.id)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
  });

  it("rejects learner submissions, modified answers and unbounded snapshots before any write", async () => {
    for (const alter of [
      (value: GeneratedWorkbookSnapshot) => {
        if (value.answers[0]) value.answers[0].submitted = "learner answer";
      },
      (value: GeneratedWorkbookSnapshot) => {
        if (value.answers[0]) value.answers[0].answer = "999";
      },
      (value: GeneratedWorkbookSnapshot) => {
        value.workbook.reason = "大".repeat(30_000);
      },
    ]) {
      const changed = structuredClone(snapshot);
      alter(changed);
      await expect(store.create(identity, changed)).rejects.toBeInstanceOf(
        GeneratedStorageError,
      );
    }
    expect(database.count("generated_instances")).toBe(0);
    expect(database.count("generated_requests")).toBe(0);
  });

  it("enforces the 64 KiB UTF-8 storage cap independently of generator validation", async () => {
    const oversized = structuredClone(snapshot);
    for (const answer of oversized.answers) {
      for (const step of answer.steps) step.reason = "学".repeat(800);
    }
    oversized.workbook.reason = "学".repeat(1000);
    oversized.workbook.lesson.rule = "学".repeat(1000);
    const { id: _id, instanceHash: _hash, ...content } = oversized.workbook;
    const hash = await sha256Hex(canonicalizeJson({ ...oversized, workbook: content }));
    oversized.workbook.instanceHash = hash;
    oversized.workbook.id = `studio-${hash}`;
    expect(await verifyGeneratedWorkbook(oversized)).toBe(true);
    expect(
      new TextEncoder().encode(canonicalizeJson(oversized)).byteLength,
    ).toBeGreaterThan(65_536);
    await expect(store.create(identity, oversized)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    expect(database.count("generated_instances")).toBe(0);
  });

  it("fails closed on missing or invalid bindings, raw request keys, and malformed DB results", async () => {
    expect(
      () => new GeneratedWorkbookStore(undefined as unknown as GeneratedDatabase),
    ).toThrow(GeneratedStorageError);
    await expect(
      store.lookupRequest({ ...identity, keyHash: "raw-key" }),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    const invalid = new GeneratedWorkbookStore({
      prepare: () => ({
        bind() {
          return this;
        },
        async all() {
          return { success: false, results: [] };
        },
      }),
      async batch() {
        return [];
      },
    });
    await expect(invalid.load(snapshot.workbook.id)).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
  });
});

describe("render job fencing and immutable completion", () => {
  beforeEach(async () => {
    await store.create(identity, snapshot);
  });

  it("has one claimant during the fixed 60-second lease and returns a busy retry time", async () => {
    const input = await renderIdentity();
    const claims = await Promise.all([
      store.claimRender(input, 1000, "first-worker-token"),
      store.claimRender(input, 1000, "other-worker-token"),
    ]);
    expect(claims.map((value) => value.status).sort()).toEqual(["busy", "claimed"]);
    const busy = claims.find((value) => value.status === "busy");
    expect(busy?.retryAt).toBe(1000 + RENDER_LEASE_MS);
    expect(database.count("generated_render_jobs")).toBe(1);
  });

  it("fences expired workers after lease reclamation, including reuse of the claim token", async () => {
    const old = await claim();
    const fresh = await claim(old.leaseExpires, old.claimToken);
    expect(fresh.leaseExpires).toBe(old.leaseExpires + RENDER_LEASE_MS);
    const artifact = { sha256: "a".repeat(64), bytes: 1024 };
    expect(await store.completeRender(old, artifact, old.leaseExpires + 1)).toBe(false);
    expect(await store.failRender(old)).toBe(false);
    expect(await store.completeRender(fresh, artifact, old.leaseExpires + 1)).toBe(
      true,
    );
  });

  it("refuses completion at lease expiry even without another worker", async () => {
    const owner = await claim();
    expect(
      await store.completeRender(
        owner,
        { sha256: "a".repeat(64), bytes: 1024 },
        owner.leaseExpires,
      ),
    ).toBe(false);
  });

  it("never overwrites a completed pointer and recovers it after a lost render response", async () => {
    const owner = await claim();
    const artifact = { sha256: "a".repeat(64), bytes: 2048 };
    expect(await store.completeRender(owner, artifact, 1001)).toBe(true);
    expect(
      await store.completeRender(owner, { sha256: "b".repeat(64), bytes: 4096 }, 1002),
    ).toBe(false);
    expect(await store.failRender(owner)).toBe(false);
    expect(
      await new GeneratedWorkbookStore(database).claimRender(
        await renderIdentity(),
        100_000,
        "another-worker-token",
      ),
    ).toEqual({ status: "complete", artifact });
  });

  it("only the current claim owner can release a failed render and retry", async () => {
    const owner = await claim();
    expect(await store.failRender({ ...owner, claimToken: "wrong-owner-token" })).toBe(
      false,
    );
    expect(await store.failRender(owner)).toBe(true);
    expect(await store.failRender(owner)).toBe(false);
    expect(
      (await store.claimRender(await renderIdentity(), 1002, "another-worker-token"))
        .status,
    ).toBe("claimed");
  });

  it("rejects job relation conflicts and cannot mutate another variant or renderer", async () => {
    const owner = await claim();
    await expect(
      store.claimRender({ ...owner, variant: "answers" }, 1001, "another-worker-token"),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    await expect(
      store.claimRender(
        { ...owner, rendererSpec: "other-renderer" },
        1001,
        "another-worker-token",
      ),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    expect(
      await store.completeRender(
        { ...owner, variant: "answers" },
        { sha256: "a".repeat(64), bytes: 1024 },
        1001,
      ),
    ).toBe(false);
    expect(await store.failRender({ ...owner, rendererSpec: "other-renderer" })).toBe(
      false,
    );
    expect(
      (
        await store.claimRender(
          await renderIdentity("answers"),
          1001,
          "answer-worker-token",
        )
      ).status,
    ).toBe("claimed");
    expect(database.count("generated_render_jobs")).toBe(2);
  });

  it("requires verified committed content and bounds claims and artifact metadata", async () => {
    const input = await renderIdentity();
    await expect(
      store.claimRender(
        { ...input, instanceId: `studio-${"a".repeat(64)}` },
        1000,
        "valid-worker-token",
      ),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    await expect(
      store.claimRender(
        { ...input, rendererSpec: "あ".repeat(400) },
        1000,
        "valid-worker-token",
      ),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    await expect(
      store.claimRender(input, -1, "valid-worker-token"),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
    await expect(store.claimRender(input, 1000, "short")).rejects.toBeInstanceOf(
      GeneratedStorageError,
    );
    const owner = await claim();
    await expect(
      store.completeRender(
        owner,
        { sha256: "a".repeat(64), bytes: 6 * 1024 * 1024 },
        1001,
      ),
    ).rejects.toBeInstanceOf(GeneratedStorageError);
  });
});
