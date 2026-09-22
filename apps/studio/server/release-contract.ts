import type { GradeItem, Topic, Workbook } from "../src/contracts";
import { canonicalizeJson, sha256Hex } from "@exercisebook/domain";

export interface ReleaseArtifact {
  readonly path: `/artifacts/${string}.pdf`;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ReleaseAsset {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: "text/html" | "text/javascript" | "text/css";
}

export interface ReleasedWorkbook {
  readonly workbook: Workbook;
  readonly answers: readonly GradeItem[];
  readonly contentSourceHashes: readonly string[];
  readonly pdfs: {
    readonly student: ReleaseArtifact;
    readonly answers: ReleaseArtifact;
  };
}

export async function computeWorkbookHash(
  workbook: Omit<Workbook, "id" | "instanceHash">,
  answers: readonly GradeItem[],
  contentSourceHashes: readonly string[],
): Promise<string> {
  return sha256Hex(
    canonicalizeJson({
      schemaVersion: "exercisebook.japanese-fixed-workbook/v1",
      selectionPolicy: "fixed-prefix-v1",
      gradingPolicy: "integer-nfkc-v1",
      contentSourceHashes,
      workbook,
      answers,
    }),
  );
}

export interface ReleaseCatalog {
  readonly schemaVersion: "studio-release-v1";
  /** studio-rc- + SHA-256(RFC 8785 canonical JSON of all fields except releaseId). */
  readonly releaseId: string;
  readonly sourceRevision: string;
  readonly topics: readonly Topic[];
  readonly workbooks: readonly ReleasedWorkbook[];
  /** Exactly index.html plus the emitted, hashed JS/CSS paths. No PDF here. */
  readonly assets: readonly ReleaseAsset[];
}
