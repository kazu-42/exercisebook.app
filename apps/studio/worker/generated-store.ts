import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import {
  verifyGeneratedWorkbook,
  type GeneratedWorkbookSnapshot,
} from "../domain/generator";
import type { PdfVariant } from "../src/contracts";

export interface D1Result<Row = Record<string, unknown>> {
  readonly success: boolean;
  readonly results: readonly Row[];
}

export interface D1Statement {
  bind(...values: readonly (string | number | null)[]): D1Statement;
  all<Row = Record<string, unknown>>(): Promise<D1Result<Row>>;
}

export interface GeneratedDatabase {
  prepare(sql: string): D1Statement;
  batch<Row = Record<string, unknown>>(
    statements: D1Statement[],
  ): Promise<D1Result<Row>[]>;
}

export interface GeneratedRequestIdentity {
  readonly keyHash: string;
  readonly requestHash: string;
  readonly releaseId: string;
}

export interface RenderIdentity {
  readonly renderSpecHash: string;
  readonly instanceId: string;
  readonly variant: PdfVariant;
  readonly rendererSpec: string;
}

export interface RenderClaim extends RenderIdentity {
  readonly claimToken: string;
  readonly leaseExpires: number;
}

export interface RenderArtifact {
  readonly sha256: string;
  readonly bytes: number;
}

export type RenderClaimResult =
  | { readonly status: "claimed"; readonly claim: RenderClaim }
  | { readonly status: "busy"; readonly retryAt: number }
  | { readonly status: "complete"; readonly artifact: RenderArtifact };

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already bound to a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export class GeneratedStorageError extends Error {
  constructor() {
    super("Generated workbook storage integrity or availability failure.");
    this.name = "GeneratedStorageError";
  }
}

export const RENDER_LEASE_MS = 60_000;
export const MAX_SNAPSHOT_BYTES = 65_536;

interface InstanceRow {
  readonly id: string;
  readonly instance_hash: string;
  readonly snapshot_hash: string;
  readonly snapshot_json: string;
}

interface RequestRow extends InstanceRow {
  readonly key_hash: string;
  readonly request_hash: string;
  readonly release_id: string;
  readonly instance_id: string;
}

interface RenderRow {
  readonly render_spec_hash: string;
  readonly instance_id: string;
  readonly variant: string;
  readonly renderer_spec: string;
  readonly state: "pending" | "claimed" | "complete";
  readonly claim_token: string | null;
  readonly lease_expires: number | null;
  readonly artifact_hash: string | null;
  readonly artifact_bytes: number | null;
}

const REQUEST_LOOKUP = `SELECT r.key_hash, r.request_hash, r.release_id, r.instance_id,
  i.id, i.instance_hash, i.snapshot_hash, i.snapshot_json
  FROM generated_requests r LEFT JOIN generated_instances i ON i.id = r.instance_id
  WHERE r.key_hash = ?`;

function check(condition: unknown): asserts condition {
  if (!condition) throw new GeneratedStorageError();
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^studio-[a-f0-9]{64}$/.test(value);
}

function identity(value: GeneratedRequestIdentity): void {
  check(value && isHash(value.keyHash) && isHash(value.requestHash));
  check(
    typeof value.releaseId === "string" &&
      /^[a-zA-Z0-9._:-]{1,200}$/.test(value.releaseId),
  );
}

function renderIdentity(value: RenderIdentity): void {
  check(value && isHash(value.renderSpecHash) && isId(value.instanceId));
  check(value.variant === "student" || value.variant === "answers");
  check(
    typeof value.rendererSpec === "string" &&
      value.rendererSpec.length > 0 &&
      new TextEncoder().encode(value.rendererSpec).byteLength <= 1024,
  );
}

function time(value: number): void {
  check(
    Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER - RENDER_LEASE_MS,
  );
}

function claimIdentity(value: RenderClaim): void {
  renderIdentity(value);
  check(
    typeof value.claimToken === "string" &&
      /^[a-zA-Z0-9_-]{16,128}$/.test(value.claimToken),
  );
  time(value.leaseExpires);
}

function artifact(value: RenderArtifact): void {
  check(
    value &&
      isHash(value.sha256) &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes > 8 &&
      value.bytes <= 5 * 1024 * 1024,
  );
}

function rows<Row>(result: D1Result<Row>): readonly Row[] {
  check(result && result.success === true && Array.isArray(result.results));
  return result.results;
}

async function readSnapshot(row: InstanceRow): Promise<GeneratedWorkbookSnapshot> {
  check(row && isId(row.id) && isHash(row.instance_hash) && isHash(row.snapshot_hash));
  check(
    typeof row.snapshot_json === "string" &&
      new TextEncoder().encode(row.snapshot_json).byteLength <= MAX_SNAPSHOT_BYTES,
  );
  check((await sha256Hex(row.snapshot_json)) === row.snapshot_hash);
  let input: unknown;
  try {
    input = JSON.parse(row.snapshot_json);
  } catch {
    throw new GeneratedStorageError();
  }
  check(await verifyGeneratedWorkbook(input));
  const snapshot = input as GeneratedWorkbookSnapshot;
  check(
    snapshot.workbook.id === row.id &&
      snapshot.workbook.instanceHash === row.instance_hash,
  );
  check(
    snapshot.answers.every(
      (answer) => answer.submitted === "" && answer.status === "unanswered",
    ),
  );
  check(canonicalizeJson(input) === row.snapshot_json);
  return snapshot;
}

function validateRenderRow(row: RenderRow, expected: RenderIdentity): void {
  check(
    row &&
      row.render_spec_hash === expected.renderSpecHash &&
      row.instance_id === expected.instanceId &&
      row.variant === expected.variant &&
      row.renderer_spec === expected.rendererSpec,
  );
  if (row.state === "pending") {
    check(
      row.claim_token === null &&
        row.lease_expires === null &&
        row.artifact_hash === null &&
        row.artifact_bytes === null,
    );
  } else if (row.state === "claimed") {
    check(
      typeof row.claim_token === "string" &&
        /^[a-zA-Z0-9_-]{16,128}$/.test(row.claim_token),
    );
    check(
      Number.isSafeInteger(row.lease_expires) &&
        Number(row.lease_expires) >= 0 &&
        row.artifact_hash === null &&
        row.artifact_bytes === null,
    );
  } else if (row.state === "complete") {
    check(row.claim_token === null && row.lease_expires === null);
    artifact({
      sha256: row.artifact_hash as string,
      bytes: row.artifact_bytes as number,
    });
  } else throw new GeneratedStorageError();
}

/** D1 transactions contain only non-personal, original-content snapshots. */
export class GeneratedWorkbookStore {
  private readonly database: GeneratedDatabase;

  constructor(database: GeneratedDatabase) {
    check(
      database &&
        typeof database.prepare === "function" &&
        typeof database.batch === "function",
    );
    this.database = database;
  }

  private async query<Row>(
    sql: string,
    values: readonly (string | number | null)[],
  ): Promise<readonly Row[]> {
    try {
      return rows(
        await this.database
          .prepare(sql)
          .bind(...values)
          .all<Row>(),
      );
    } catch {
      throw new GeneratedStorageError();
    }
  }

  private async batch<Row>(
    statements: D1Statement[],
  ): Promise<readonly (readonly Row[])[]> {
    try {
      const result = await this.database.batch<Row>(statements);
      check(Array.isArray(result) && result.length === statements.length);
      return result.map(rows);
    } catch {
      throw new GeneratedStorageError();
    }
  }

  async load(id: string): Promise<GeneratedWorkbookSnapshot | undefined> {
    check(isId(id));
    const result = await this.query<InstanceRow>(
      "SELECT id, instance_hash, snapshot_hash, snapshot_json FROM generated_instances WHERE id = ?",
      [id],
    );
    check(result.length <= 1);
    check(!result[0] || result[0].id === id);
    return result[0] ? readSnapshot(result[0]) : undefined;
  }

  async lookupRequest(
    request: GeneratedRequestIdentity,
  ): Promise<GeneratedWorkbookSnapshot | undefined> {
    identity(request);
    request = { ...request };
    const result = await this.query<RequestRow>(REQUEST_LOOKUP, [request.keyHash]);
    check(result.length <= 1);
    if (!result[0]) return undefined;
    return this.checkedRequest(result[0], request);
  }

  private async checkedRequest(
    row: RequestRow,
    request: GeneratedRequestIdentity,
  ): Promise<GeneratedWorkbookSnapshot> {
    check(row.key_hash === request.keyHash && isHash(row.request_hash));
    if (row.request_hash !== request.requestHash) throw new IdempotencyConflictError();
    // The original release is retained. Replay never binds to a new deployment.
    check(
      row.instance_id === row.id &&
        typeof row.release_id === "string" &&
        row.release_id.length > 0,
    );
    return readSnapshot(row);
  }

  async create(
    request: GeneratedRequestIdentity,
    snapshot: GeneratedWorkbookSnapshot,
  ): Promise<GeneratedWorkbookSnapshot> {
    identity(request);
    request = { ...request };
    // Capture caller-owned values before the first asynchronous validation.
    const snapshotJson = canonicalizeJson(snapshot);
    check(new TextEncoder().encode(snapshotJson).byteLength <= MAX_SNAPSHOT_BYTES);
    snapshot = JSON.parse(snapshotJson) as GeneratedWorkbookSnapshot;
    check(await verifyGeneratedWorkbook(snapshot));
    check(
      snapshot.answers.every(
        (answer) => answer.submitted === "" && answer.status === "unanswered",
      ),
    );
    const snapshotHash = await sha256Hex(snapshotJson);
    const { id, instanceHash } = snapshot.workbook;
    check(isId(id) && isHash(instanceHash));
    // D1 batch executes atomically. A losing same-key request inserts no new
    // instance; the conditional request insert also rejects an ID/hash collision.
    const result = await this.batch<RequestRow>([
      this.database
        .prepare(
          `INSERT INTO generated_instances (id, instance_hash, snapshot_hash, snapshot_json)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM generated_requests WHERE key_hash = ?)
        ON CONFLICT DO NOTHING`,
        )
        .bind(id, instanceHash, snapshotHash, snapshotJson, request.keyHash),
      this.database
        .prepare(
          `INSERT INTO generated_requests (key_hash, request_hash, release_id, instance_id)
        SELECT ?, ?, ?, id FROM generated_instances WHERE id = ? AND instance_hash = ? AND snapshot_hash = ? AND snapshot_json = ?
        ON CONFLICT(key_hash) DO NOTHING`,
        )
        .bind(
          request.keyHash,
          request.requestHash,
          request.releaseId,
          id,
          instanceHash,
          snapshotHash,
          snapshotJson,
        ),
      this.database.prepare(REQUEST_LOOKUP).bind(request.keyHash),
    ]);
    const winner = result[2];
    check(winner?.length === 1 && winner[0]);
    return this.checkedRequest(winner[0], request);
  }

  async claimRender(
    input: RenderIdentity,
    nowMs: number,
    claimToken: string,
  ): Promise<RenderClaimResult> {
    renderIdentity(input);
    time(nowMs);
    input = { ...input };
    const claim: RenderClaim = {
      ...input,
      claimToken,
      leaseExpires: nowMs + RENDER_LEASE_MS,
    };
    claimIdentity(claim);
    // A render may only reference a verified, committed immutable snapshot.
    check(await this.load(input.instanceId));
    const result = await this.batch<RenderRow>([
      this.database
        .prepare(
          `INSERT INTO generated_render_jobs (render_spec_hash, instance_id, variant, renderer_spec, state)
        VALUES (?, ?, ?, ?, 'pending') ON CONFLICT(render_spec_hash) DO NOTHING`,
        )
        .bind(
          input.renderSpecHash,
          input.instanceId,
          input.variant,
          input.rendererSpec,
        ),
      this.database
        .prepare(
          `UPDATE generated_render_jobs SET state = 'claimed', claim_token = ?, lease_expires = ?
        WHERE render_spec_hash = ? AND instance_id = ? AND variant = ? AND renderer_spec = ?
        AND (state = 'pending' OR (state = 'claimed' AND lease_expires <= ?)) RETURNING *`,
        )
        .bind(
          claimToken,
          claim.leaseExpires,
          input.renderSpecHash,
          input.instanceId,
          input.variant,
          input.rendererSpec,
          nowMs,
        ),
      this.database
        .prepare("SELECT * FROM generated_render_jobs WHERE render_spec_hash = ?")
        .bind(input.renderSpecHash),
    ]);
    const found = result[2];
    check(found?.length === 1 && found[0]);
    const row = found[0];
    validateRenderRow(row, input);
    if (row.state === "complete")
      return {
        status: "complete",
        artifact: {
          sha256: row.artifact_hash as string,
          bytes: row.artifact_bytes as number,
        },
      };
    check(row.state === "claimed");
    check(result[1] && result[1].length <= 1);
    if (result[1].length === 1) {
      check(row.claim_token === claimToken && row.lease_expires === claim.leaseExpires);
      return { status: "claimed", claim };
    }
    return { status: "busy", retryAt: row.lease_expires as number };
  }

  async completeRender(
    claim: RenderClaim,
    result: RenderArtifact,
    nowMs: number,
  ): Promise<boolean> {
    claimIdentity(claim);
    artifact(result);
    time(nowMs);
    const changed = await this.query<RenderRow>(
      `UPDATE generated_render_jobs
      SET state = 'complete', claim_token = NULL, lease_expires = NULL, artifact_hash = ?, artifact_bytes = ?
      WHERE render_spec_hash = ? AND instance_id = ? AND variant = ? AND renderer_spec = ?
      AND state = 'claimed' AND claim_token = ? AND lease_expires = ? AND lease_expires > ?
      RETURNING *`,
      [
        result.sha256,
        result.bytes,
        claim.renderSpecHash,
        claim.instanceId,
        claim.variant,
        claim.rendererSpec,
        claim.claimToken,
        claim.leaseExpires,
        nowMs,
      ],
    );
    check(changed.length <= 1);
    if (!changed[0]) return false;
    validateRenderRow(changed[0], claim);
    check(
      changed[0].state === "complete" &&
        changed[0].artifact_hash === result.sha256 &&
        changed[0].artifact_bytes === result.bytes,
    );
    return true;
  }

  async failRender(claim: RenderClaim): Promise<boolean> {
    claimIdentity(claim);
    const changed = await this.query<RenderRow>(
      `UPDATE generated_render_jobs
      SET state = 'pending', claim_token = NULL, lease_expires = NULL
      WHERE render_spec_hash = ? AND instance_id = ? AND variant = ? AND renderer_spec = ?
      AND state = 'claimed' AND claim_token = ? AND lease_expires = ? RETURNING *`,
      [
        claim.renderSpecHash,
        claim.instanceId,
        claim.variant,
        claim.rendererSpec,
        claim.claimToken,
        claim.leaseExpires,
      ],
    );
    check(changed.length <= 1);
    if (!changed[0]) return false;
    validateRenderRow(changed[0], claim);
    return true;
  }
}
