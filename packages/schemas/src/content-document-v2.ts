import { z } from "zod";

import {
  assertSafeDataObjectGraph,
  HttpUrlSchema,
  LocaleSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
} from "./common.js";
import { derivePhase1MathAccessibleText } from "./phase-1-safe-math.js";
import {
  CONTENT_COMPILER_V2,
  FractionAdditionWorkedExampleModelV1Schema,
  PresentationPlainTextV1Schema,
} from "./presentation-contract-v1.js";

export {
  CONTENT_COMPILER_V2,
  FractionAdditionWorkedExampleModelV1Schema,
  PresentationPlainTextV1Schema,
  deriveFractionAdditionWorkedExampleArithmetic,
} from "./presentation-contract-v1.js";
export type {
  FractionAdditionWorkedExampleModelV1,
  PresentationPlainTextV1,
} from "./presentation-contract-v1.js";

export const CONTENT_DOCUMENT_V2_SCHEMA = "exercisebook.content-ast/v2";

const TextInlineLeafV2Schema = z.strictObject({
  type: z.literal("text"),
  value: z.string().min(1).max(20_000),
});

const MathInlineLeafV2Schema = z.strictObject({
  type: z.literal("math"),
  source: z.string().min(1).max(2_000),
  accessibleText: z.string().min(1).max(2_000),
});

const InlineLeafV2Schema = z.discriminatedUnion("type", [
  TextInlineLeafV2Schema,
  MathInlineLeafV2Schema,
]);

export const ContentInlineV2Schema = z.discriminatedUnion("type", [
  ...InlineLeafV2Schema.options,
  z.strictObject({
    type: z.literal("emphasis"),
    children: z.array(InlineLeafV2Schema).min(1).max(1_000),
  }),
  z.strictObject({
    type: z.literal("strong"),
    children: z.array(InlineLeafV2Schema).min(1).max(1_000),
  }),
]);

type ContentInlineV2Output = z.infer<typeof ContentInlineV2Schema>;

export const ContentParagraphV2Schema = z.strictObject({
  type: z.literal("paragraph"),
  children: z.array(ContentInlineV2Schema).min(1).max(2_000),
});

const PresentationBodyV1Schema = z.array(PresentationPlainTextV1Schema).min(1).max(8);

const DirectiveBodyV2Schema = z.array(ContentParagraphV2Schema).min(1).max(200);

export const ContentBlockV2Schema = z.discriminatedUnion("type", [
  ContentParagraphV2Schema,
  z.strictObject({
    type: z.literal("heading"),
    level: z.number().int().min(1).max(6),
    children: z.array(ContentInlineV2Schema).min(1).max(2_000),
  }),
  z.strictObject({
    type: z.literal("explanation"),
    id: StableIdSchema,
    title: z.string().min(1).max(240),
    paragraphs: PresentationBodyV1Schema,
  }),
  z.strictObject({
    type: z.literal("worked-example"),
    id: StableIdSchema,
    title: z.string().min(1).max(240),
    model: FractionAdditionWorkedExampleModelV1Schema,
    steps: PresentationBodyV1Schema,
  }),
  z.strictObject({
    type: z.literal("exercise"),
    id: StableIdSchema,
    generator: z.strictObject({
      id: StableIdSchema,
      version: z.string().min(1).max(80),
      parameters: z.record(
        z.string().min(1).max(80),
        z.union([z.string().max(500), z.number().finite(), z.boolean()]),
      ),
    }),
    count: z.number().int().min(1).max(200),
    instruction: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("interactive"),
    id: StableIdSchema,
    kind: z.enum(["fraction-bars"]),
    prompt: z.string().min(1).max(2_000),
    printFallback: z.string().min(1).max(2_000),
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("hint"),
    id: StableIdSchema,
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("reflection"),
    id: StableIdSchema,
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("callout"),
    id: StableIdSchema,
    tone: z.enum(["note", "tip", "warning"]),
    children: DirectiveBodyV2Schema,
  }),
  z.strictObject({
    type: z.literal("figure"),
    id: StableIdSchema,
    assetId: StableIdSchema,
    alt: z.string().min(1).max(2_000),
    caption: z.string().min(1).max(2_000),
  }),
]);

export const ContentDocumentV2Schema = z
  .strictObject({
    schema: z.literal(CONTENT_DOCUMENT_V2_SCHEMA),
    id: StableIdSchema,
    revision: RevisionSchema,
    locale: LocaleSchema,
    title: z.string().min(1).max(240),
    skills: z.array(StableIdSchema).min(1).max(20),
    prerequisites: z.array(StableIdSchema).max(100),
    authors: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(240),
          role: z.enum(["author", "reviewer"]),
        }),
      )
      .min(1)
      .max(100),
    license: z.strictObject({
      licenseId: z.string().min(1).max(160),
      sourceUrl: HttpUrlSchema,
      attributionText: z.string().min(1).max(1_000),
      copyrightHolder: z.string().min(1).max(240),
    }),
    publication: z.strictObject({
      status: z.enum(["draft", "published"]),
    }),
    estimatedMinutes: z.number().int().positive().max(480),
    nodes: z.array(ContentBlockV2Schema).min(1).max(10_000),
    sourceHash: Sha256HexSchema,
    compilerVersion: z.literal(CONTENT_COMPILER_V2),
  })
  .superRefine((document, context) => {
    validateContentMath(document.nodes, context);
    validateUniqueReferences(document, context);

    const attributionAuthor = document.authors.map((author) => author.name).join(", ");
    if (attributionAuthor.length > 240) {
      context.addIssue({
        code: "custom",
        message:
          "Combined author names must fit the 240-character attribution author field",
        path: ["authors"],
      });
    }

    const skills = new Set(document.skills);
    for (const [index, prerequisite] of document.prerequisites.entries()) {
      if (skills.has(prerequisite)) {
        context.addIssue({
          code: "custom",
          message: "A prerequisite cannot also be a taught skill",
          path: ["prerequisites", index],
        });
      }
    }
  });

export type ContentDocumentV2 = z.infer<typeof ContentDocumentV2Schema>;
export type ContentBlockV2 = z.infer<typeof ContentBlockV2Schema>;
export type ContentParagraphV2 = z.infer<typeof ContentParagraphV2Schema>;
export type ContentInlineV2 = z.infer<typeof ContentInlineV2Schema>;

export function validateContentDocumentV2(value: unknown): ContentDocumentV2 {
  assertSafeDataObjectGraph(value);
  return ContentDocumentV2Schema.parse(value);
}

function validateContentMath(
  nodes: readonly ContentBlockV2[],
  context: z.RefinementCtx,
): void {
  const validateMath = (
    math: { readonly source: string; readonly accessibleText: string },
    path: readonly (string | number)[],
  ): void => {
    let derivedAccessibleText: string;
    try {
      derivedAccessibleText = derivePhase1MathAccessibleText(math.source);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid Phase-1 math source",
        path: [...path, "source"],
      });
      return;
    }
    if (math.accessibleText !== derivedAccessibleText) {
      context.addIssue({
        code: "custom",
        message: "Math accessibleText must equal its deterministic Phase-1 derivation",
        path: [...path, "accessibleText"],
      });
    }
  };
  const validateInlineChildren = (
    children: readonly ContentInlineV2Output[],
    path: readonly (string | number)[],
  ): void => {
    for (const [inlineIndex, inline] of children.entries()) {
      const inlinePath = [...path, inlineIndex];
      if (inline.type === "math") {
        validateMath(inline, inlinePath);
      } else if (inline.type === "emphasis" || inline.type === "strong") {
        for (const [leafIndex, leaf] of inline.children.entries()) {
          if (leaf.type === "math") {
            validateMath(leaf, [...inlinePath, "children", leafIndex]);
          }
        }
      }
    }
  };

  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.type === "paragraph" || node.type === "heading") {
      validateInlineChildren(node.children, ["nodes", nodeIndex, "children"]);
    } else if (
      node.type === "interactive" ||
      node.type === "hint" ||
      node.type === "reflection" ||
      node.type === "callout"
    ) {
      for (const [paragraphIndex, paragraph] of node.children.entries()) {
        validateInlineChildren(paragraph.children, [
          "nodes",
          nodeIndex,
          "children",
          paragraphIndex,
          "children",
        ]);
      }
    }
  }
}

function validateUniqueReferences(
  document: {
    readonly skills: readonly string[];
    readonly prerequisites: readonly string[];
    readonly nodes: readonly ContentBlockV2[];
  },
  context: z.RefinementCtx,
): void {
  for (const [field, values] of [
    ["skills", document.skills],
    ["prerequisites", document.prerequisites],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message:
            field === "skills"
              ? `Duplicate taught skill ID: ${value}`
              : `Duplicate prerequisite ID: ${value}`,
          path: [field, index],
        });
      }
      seen.add(value);
    }
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of document.nodes.entries()) {
    if (!("id" in node)) {
      continue;
    }
    if (nodeIds.has(node.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate content node ID: ${node.id}`,
        path: ["nodes", index, "id"],
      });
    }
    nodeIds.add(node.id);
  }
}
