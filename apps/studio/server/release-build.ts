import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";
import type { GradeItem, Workbook } from "../src/contracts";
import { createWorkbook, getAnswerKey, topics } from "./model";
import { computeWorkbookHash } from "./release-contract";

export interface MaterializedWorkbook {
  readonly workbook: Workbook;
  readonly answers: readonly GradeItem[];
  readonly contentSourceHashes: readonly string[];
}

/** Select and freeze the complete finite catalog before any HTTP presentation. */
export async function materializeWorkbooks(
  contentSourceHashes: readonly string[],
): Promise<readonly MaterializedWorkbook[]> {
  if (
    contentSourceHashes.length === 0 ||
    contentSourceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
    new Set(contentSourceHashes).size !== contentSourceHashes.length
  )
    throw new Error("Expected distinct content source hashes.");
  const sourceHashes = [...contentSourceHashes].sort();
  const result: MaterializedWorkbook[] = [];
  for (const topic of topics) {
    for (const level of ["foundation", "standard"] as const) {
      for (const count of [4, 6, 8] as const) {
        const draft = createWorkbook({ topicId: topic.id, level, count });
        const answers = getAnswerKey(draft);
        const { id: _id, instanceHash: _hash, ...semanticWorkbook } = draft;
        const instanceHash = await computeWorkbookHash(
          semanticWorkbook,
          answers,
          sourceHashes,
        );
        result.push({
          workbook: {
            ...semanticWorkbook,
            id: "studio-" + instanceHash,
            instanceHash,
          },
          answers,
          contentSourceHashes: sourceHashes,
        });
      }
    }
  }
  if (
    result.length !== 18 ||
    new Set(result.map((entry) => entry.workbook.id)).size !== 18
  )
    throw new Error("The fixed catalog must contain exactly 18 distinct sets.");
  return result;
}

export async function releaseIdFor(value: unknown): Promise<string> {
  return "studio-rc-" + (await sha256Hex(canonicalizeJson(value)));
}
