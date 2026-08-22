import {
  addRationals,
  canonicalizeJson,
  createRational,
  createXoshiro128ss,
  deriveSlotSeed,
  equalRationals,
  greatestCommonDivisor,
  leastCommonMultiple,
  sha256Hex,
  validateSeed256,
  type RationalJson,
} from "@exercisebook/domain";
import {
  AttributionV1Schema,
  CONTENT_COMPILER_V1,
  LocalDateSchema,
  LocaleSchema,
  RNG_ALGORITHM_V1,
  RationalJsonSchema,
  RevisionSchema,
  Sha256HexSchema,
  StableIdSchema,
  TimeZoneSchema,
  WORKSHEET_INSTANCE_V1_SCHEMA,
  assertSafeDataObjectGraph,
  deriveFractionAdditionAccessibilitySummary,
  deriveFractionAdditionPromptAccessibleText,
  validateContentDocumentV1,
  validateWorksheetInstanceV1,
  type AttributionV1,
  type ContentDocumentV1,
  type MaterializedWorksheetInstanceV1,
  type SolutionStepV1,
  type WorksheetInstanceV1,
  type WorksheetSlotV1,
} from "@exercisebook/schemas";
import { z } from "zod";

export const FRACTION_ADDITION_GENERATOR_ID = "fractions.add";
export const FRACTION_ADDITION_GENERATOR_VERSION = "1";
// Difficulty 1 has 112 commutatively unique prompts. The public materializer
// caps worksheets below full pool exhaustion so the per-slot 128-attempt
// duplicate retry remains operationally reliable across seeds.
export const MAX_FRACTION_ADDITION_ITEMS = 96;
const MAX_DUPLICATE_RETRIES = 127;

export interface FractionAdditionContentReference {
  readonly id: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly compilerVersion: typeof CONTENT_COMPILER_V1;
  readonly title: string;
  readonly skillIds: readonly string[];
  readonly instruction: string;
  readonly attribution: AttributionV1;
}

export interface FractionAdditionWorksheetInput {
  readonly assignmentId: string;
  readonly localStudyDate: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly seed: string;
  readonly seedSecretVersion: string;
  readonly plan: {
    readonly id: string;
    readonly version: number;
  };
  readonly policy: {
    readonly id: string;
    readonly version: number;
  };
  readonly skillGraph: {
    readonly id: string;
    readonly revision: number;
  };
  readonly selectionReasons: readonly WorksheetSlotV1["selectionReasons"][number][];
  readonly excludedCanonicalAnswers?: readonly RationalJson[] | undefined;
  readonly itemCount: number;
  readonly difficulty: number;
  readonly content: FractionAdditionContentReference;
}

export interface FractionAdditionAssignmentInput extends Pick<
  FractionAdditionWorksheetInput,
  | "assignmentId"
  | "localStudyDate"
  | "timeZone"
  | "locale"
  | "seed"
  | "seedSecretVersion"
  | "plan"
  | "policy"
  | "skillGraph"
  | "selectionReasons"
  | "excludedCanonicalAnswers"
> {
  readonly requestedItemCount: number;
}

export interface FractionAdditionProblemModelV1 {
  readonly left: RationalJson;
  readonly right: RationalJson;
  readonly commonDenominator: string;
  readonly leftScaledNumerator: string;
  readonly rightScaledNumerator: string;
  readonly unreducedSumNumerator: string;
}

export interface GeneratedFractionAdditionV1 {
  readonly model: FractionAdditionProblemModelV1;
  readonly prompt: WorksheetSlotV1["prompt"];
  readonly canonicalAnswer: WorksheetSlotV1["canonicalAnswer"];
  readonly scoringRule: WorksheetSlotV1["scoringRule"];
  readonly hints: WorksheetSlotV1["hints"];
  readonly solutionTrace: readonly SolutionStepV1[];
  readonly misconceptions: WorksheetSlotV1["misconceptions"];
  readonly accessibility: WorksheetSlotV1["accessibility"];
  readonly printFallback: WorksheetSlotV1["printFallback"];
}

export interface GenerateFractionAdditionInput {
  readonly slotSeed: string;
  readonly difficulty: number;
}

const FractionAdditionContentReferenceSchema = z.strictObject({
  id: StableIdSchema,
  revision: RevisionSchema,
  sourceHash: Sha256HexSchema,
  contentHash: Sha256HexSchema,
  compilerVersion: z.literal(CONTENT_COMPILER_V1),
  title: z.string().min(1).max(240),
  skillIds: z.array(StableIdSchema).min(1).max(20),
  instruction: z.string().min(1).max(500),
  attribution: AttributionV1Schema,
});

const PlannerProvenanceShape = {
  plan: z.strictObject({
    id: StableIdSchema,
    version: RevisionSchema,
  }),
  policy: z.strictObject({
    id: StableIdSchema,
    version: RevisionSchema,
  }),
  skillGraph: z.strictObject({
    id: StableIdSchema,
    revision: RevisionSchema,
  }),
  selectionReasons: z
    .array(
      z.enum(["due-review", "prerequisite-repair", "current-frontier", "transfer"]),
    )
    .min(1)
    .max(10),
  excludedCanonicalAnswers: z.array(RationalJsonSchema).max(32).optional(),
} as const;

const FractionAdditionWorksheetInputSchema = z.strictObject({
  assignmentId: StableIdSchema,
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: LocaleSchema,
  seed: Sha256HexSchema,
  seedSecretVersion: StableIdSchema,
  ...PlannerProvenanceShape,
  itemCount: z
    .number()
    .int()
    .min(1, `itemCount must be an integer from 1 to ${MAX_FRACTION_ADDITION_ITEMS}`)
    .max(
      MAX_FRACTION_ADDITION_ITEMS,
      `itemCount must be an integer from 1 to ${MAX_FRACTION_ADDITION_ITEMS}`,
    ),
  difficulty: z.number().int().min(1).max(5),
  content: FractionAdditionContentReferenceSchema,
});

const FractionAdditionAssignmentInputSchema = z.strictObject({
  assignmentId: StableIdSchema,
  localStudyDate: LocalDateSchema,
  timeZone: TimeZoneSchema,
  locale: LocaleSchema,
  seed: Sha256HexSchema,
  seedSecretVersion: StableIdSchema,
  ...PlannerProvenanceShape,
  requestedItemCount: z
    .number()
    .int()
    .min(
      1,
      `requestedItemCount must be an integer from 1 to ${MAX_FRACTION_ADDITION_ITEMS}`,
    )
    .max(
      MAX_FRACTION_ADDITION_ITEMS,
      `requestedItemCount must be an integer from 1 to ${MAX_FRACTION_ADDITION_ITEMS}`,
    ),
});

export const FRACTION_ADDITION_SAMPLE_INPUT: FractionAdditionWorksheetInput = {
  assignmentId: "sample-fractions-2026-07-19",
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en",
  seed: "0123456789abcdef".repeat(4),
  seedSecretVersion: "public-sample-v1",
  plan: {
    id: "phase-1-fraction-addition",
    version: 1,
  },
  policy: {
    id: "rule-based-daily-plan",
    version: 1,
  },
  skillGraph: {
    id: "phase-1-math",
    revision: 1,
  },
  selectionReasons: ["current-frontier"],
  itemCount: 8,
  difficulty: 2,
  content: {
    id: "math.fractions.add-unlike-denominators",
    revision: 1,
    sourceHash: "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
    contentHash: "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
    compilerVersion: CONTENT_COMPILER_V1,
    title: "Add fractions with unlike denominators",
    skillIds: ["math.fractions.add-unlike"],
    instruction: "Add each pair of fractions. Give every answer in lowest terms.",
    attribution: {
      title: "Add fractions with unlike denominators",
      author: "Exercise Book contributors",
      sourceUrl:
        "https://exercisebook.app/content/math/fractions/add-unlike-denominators",
      licenseId: "LicenseRef-ExerciseBook-Draft",
      attributionText:
        "Draft original lesson by Exercise Book contributors. Not yet licensed for publication.",
      publicationStatus: "draft",
      modifications: [],
    },
  },
};

export function generateFractionAdditionProblem(
  input: GenerateFractionAdditionInput,
): GeneratedFractionAdditionV1 {
  validateSeed256(input.slotSeed);
  if (
    !Number.isInteger(input.difficulty) ||
    input.difficulty < 1 ||
    input.difficulty > 5
  ) {
    throw new RangeError("Fraction-addition difficulty must be an integer from 1 to 5");
  }

  const random = createXoshiro128ss(input.slotSeed);
  const maximumDenominator = 5 + input.difficulty * 2;
  const denominators = integerRange(2, maximumDenominator);
  const leftDenominator = denominators[random.nextInt(0, denominators.length)];
  if (leftDenominator === undefined) {
    throw new Error("The left denominator candidate set is empty");
  }
  const rightDenominators = denominators.filter(
    (candidate) => candidate !== leftDenominator,
  );
  const rightDenominator =
    rightDenominators[random.nextInt(0, rightDenominators.length)];
  if (rightDenominator === undefined) {
    throw new Error("The right denominator candidate set is empty");
  }

  const left = createRational(
    BigInt(selectCoprimeNumerator(random.nextUint32(), leftDenominator)),
    BigInt(leftDenominator),
  );
  const right = createRational(
    BigInt(selectCoprimeNumerator(random.nextUint32(), rightDenominator)),
    BigInt(rightDenominator),
  );
  const answer = addRationals(left, right);
  const commonDenominator = leastCommonMultiple(
    BigInt(left.denominator),
    BigInt(right.denominator),
  );
  const leftScaledNumerator =
    BigInt(left.numerator) * (commonDenominator / BigInt(left.denominator));
  const rightScaledNumerator =
    BigInt(right.numerator) * (commonDenominator / BigInt(right.denominator));
  const unreducedSumNumerator = leftScaledNumerator + rightScaledNumerator;
  const leftDisplay = formatFraction(left);
  const rightDisplay = formatFraction(right);
  const answerDisplay = formatFraction(answer);

  const answerRequiredReduction =
    unreducedSumNumerator.toString() !== answer.numerator ||
    commonDenominator.toString() !== answer.denominator;
  const solutionTrace: SolutionStepV1[] = [
    {
      id: "find-common-denominator",
      kind: "common-denominator",
      explanation: `Use ${commonDenominator.toString()} as the least common denominator.`,
      expression: `\\operatorname{lcm}(${left.denominator},${right.denominator})=${commonDenominator.toString()}`,
      accessibleText: `The least common denominator is ${commonDenominator.toString()}.`,
    },
    {
      id: "rewrite-left",
      kind: "rewrite-left",
      explanation: "Rewrite the first addend with the common denominator.",
      expression: `${leftDisplay}=\\frac{${leftScaledNumerator.toString()}}{${commonDenominator.toString()}}`,
      accessibleText: `${left.numerator} over ${left.denominator} equals ${leftScaledNumerator.toString()} over ${commonDenominator.toString()}.`,
      result: left,
    },
    {
      id: "rewrite-right",
      kind: "rewrite-right",
      explanation: "Rewrite the second addend with the common denominator.",
      expression: `${rightDisplay}=\\frac{${rightScaledNumerator.toString()}}{${commonDenominator.toString()}}`,
      accessibleText: `${right.numerator} over ${right.denominator} equals ${rightScaledNumerator.toString()} over ${commonDenominator.toString()}.`,
      result: right,
    },
    {
      id: "add-numerators",
      kind: "add-numerators",
      explanation: "Add the numerators while keeping the common denominator.",
      expression: `\\frac{${leftScaledNumerator.toString()}+${rightScaledNumerator.toString()}}{${commonDenominator.toString()}}=\\frac{${unreducedSumNumerator.toString()}}{${commonDenominator.toString()}}`,
      accessibleText: `${leftScaledNumerator.toString()} plus ${rightScaledNumerator.toString()} over ${commonDenominator.toString()} is ${unreducedSumNumerator.toString()} over ${commonDenominator.toString()}.`,
      result: answer,
    },
    {
      id: "reduce-answer",
      kind: "reduce",
      explanation: answerRequiredReduction
        ? "Reduce the fraction to lowest terms."
        : "Check the fraction. It is already in lowest terms.",
      expression: `\\frac{${unreducedSumNumerator.toString()}}{${commonDenominator.toString()}}=${answerDisplay}`,
      accessibleText: answerRequiredReduction
        ? `In lowest terms, the answer is ${answer.numerator} over ${answer.denominator}.`
        : `${answer.numerator} over ${answer.denominator} is already in lowest terms.`,
      result: answer,
    },
  ];

  return {
    model: {
      left,
      right,
      commonDenominator: commonDenominator.toString(),
      leftScaledNumerator: leftScaledNumerator.toString(),
      rightScaledNumerator: rightScaledNumerator.toString(),
      unreducedSumNumerator: unreducedSumNumerator.toString(),
    },
    prompt: {
      type: "fraction-addition",
      instruction: "Add. Give your answer in lowest terms.",
      left,
      right,
      accessibleText: deriveFractionAdditionPromptAccessibleText(left, right),
    },
    canonicalAnswer: {
      type: "rational",
      value: answer,
    },
    scoringRule: {
      type: "rational-equals",
      accepted: answer,
      requireReduced: true,
    },
    hints: [
      {
        id: "hint-common-denominator",
        text: `Find the least common multiple of ${left.denominator} and ${right.denominator}.`,
      },
      {
        id: "hint-equivalent-fractions",
        text: "Rewrite both addends as equivalent fractions with that denominator.",
      },
    ],
    solutionTrace,
    misconceptions: buildMisconceptions(left, right, answer),
    accessibility: {
      summary: deriveFractionAdditionAccessibilitySummary(left, right),
    },
    printFallback: {
      type: "text",
      text: "Draw equal fraction bars for both addends, partition them into the least common denominator, then combine the shaded parts.",
    },
  };
}

export async function materializeFractionAdditionWorksheet(
  input: FractionAdditionWorksheetInput,
): Promise<MaterializedWorksheetInstanceV1> {
  const stableInput = validateWorksheetInput(input);
  const slots: WorksheetSlotV1[] = [];
  const promptSignatures = new Set<string>();
  const excludedAnswerSignatures = new Set(
    (stableInput.excludedCanonicalAnswers ?? []).map(rationalSignature),
  );

  for (let index = 0; index < stableInput.itemCount; index += 1) {
    const id = `practice-${String(index + 1).padStart(2, "0")}`;
    let selected:
      | {
          readonly slotSeed: string;
          readonly generated: GeneratedFractionAdditionV1;
          readonly generationAttempt: number;
        }
      | undefined;
    for (
      let generationAttempt = 0;
      generationAttempt <= MAX_DUPLICATE_RETRIES;
      generationAttempt += 1
    ) {
      const derivationSlotId =
        generationAttempt === 0 ? id : `${id}:retry-${generationAttempt}`;
      const slotSeed = await deriveSlotSeed({
        baseSeed: stableInput.seed,
        generatorId: FRACTION_ADDITION_GENERATOR_ID,
        generatorVersion: FRACTION_ADDITION_GENERATOR_VERSION,
        slotId: derivationSlotId,
      });
      const generated = generateFractionAdditionProblem({
        slotSeed,
        difficulty: stableInput.difficulty,
      });
      const signature = fractionAdditionPromptSignature(generated);
      const answerSignature = rationalSignature(generated.canonicalAnswer.value);
      if (
        !promptSignatures.has(signature) &&
        !excludedAnswerSignatures.has(answerSignature)
      ) {
        promptSignatures.add(signature);
        selected = { slotSeed, generated, generationAttempt };
        break;
      }
    }
    if (selected === undefined) {
      throw new DeterministicGenerationExhaustedError(
        `Could not generate a unique problem for ${id} after ${MAX_DUPLICATE_RETRIES + 1} deterministic attempts`,
      );
    }
    const { slotSeed, generated, generationAttempt } = selected;
    slots.push({
      id,
      skillIds: [...stableInput.content.skillIds],
      slotSeed,
      selectionReasons: [...stableInput.selectionReasons],
      expectedMinutes: 2,
      prompt: {
        ...generated.prompt,
        instruction: stableInput.content.instruction,
      },
      canonicalAnswer: generated.canonicalAnswer,
      scoringRule: generated.scoringRule,
      hints: [...generated.hints],
      solutionTrace: [...generated.solutionTrace],
      misconceptions: [...generated.misconceptions],
      accessibility: generated.accessibility,
      printFallback: generated.printFallback,
      provenance: {
        contentId: stableInput.content.id,
        contentRevision: stableInput.content.revision,
        sourceHash: stableInput.content.sourceHash,
        contentHash: stableInput.content.contentHash,
        compilerVersion: stableInput.content.compilerVersion,
        generatorId: FRACTION_ADDITION_GENERATOR_ID,
        generatorVersion: FRACTION_ADDITION_GENERATOR_VERSION,
        generationAttempt,
      },
    });
  }

  const instance: WorksheetInstanceV1 = validateWorksheetInstanceV1({
    schema: WORKSHEET_INSTANCE_V1_SCHEMA,
    assignmentId: stableInput.assignmentId,
    title: stableInput.content.title,
    localStudyDate: stableInput.localStudyDate,
    timeZone: stableInput.timeZone,
    locale: stableInput.locale,
    expectedMinutes: slots.reduce((total, slot) => total + slot.expectedMinutes, 0),
    plan: stableInput.plan,
    policy: stableInput.policy,
    skillGraph: stableInput.skillGraph,
    rng: {
      algorithm: RNG_ALGORITHM_V1,
      baseSeed: stableInput.seed,
      seedSecretVersion: stableInput.seedSecretVersion,
    },
    content: [
      {
        id: stableInput.content.id,
        revision: stableInput.content.revision,
        sourceHash: stableInput.content.sourceHash,
        contentHash: stableInput.content.contentHash,
        compilerVersion: stableInput.content.compilerVersion,
      },
    ],
    slots,
    attributions: [stableInput.content.attribution],
  });
  const canonicalJson = canonicalizeJson(instance);
  const instanceHash = await sha256Hex(canonicalJson);
  return { instance, canonicalJson, instanceHash };
}

export async function fractionAdditionWorksheetInputFromContent(
  document: ContentDocumentV1,
  assignment: FractionAdditionAssignmentInput,
): Promise<FractionAdditionWorksheetInput> {
  assertSafeDataObjectGraph(assignment);
  const validatedAssignment = FractionAdditionAssignmentInputSchema.parse(assignment);
  const validatedDocument = validateContentDocumentV1(document);
  if (validatedDocument.publication.status !== "draft") {
    throw new RangeError(
      "Published content requires a trusted release approval unavailable in Phase 1",
    );
  }
  const matchingExercises = validatedDocument.nodes.filter(
    (node) =>
      node.type === "exercise" &&
      node.generator.id === FRACTION_ADDITION_GENERATOR_ID &&
      node.generator.version === FRACTION_ADDITION_GENERATOR_VERSION,
  );
  if (matchingExercises.length !== 1) {
    throw new RangeError(
      `Expected exactly one ${FRACTION_ADDITION_GENERATOR_ID}@${FRACTION_ADDITION_GENERATOR_VERSION} exercise directive`,
    );
  }
  const exercise = matchingExercises[0];
  if (exercise === undefined || exercise.type !== "exercise") {
    throw new Error("The resolved fraction exercise is unavailable");
  }
  const difficulty = exercise.generator.parameters.difficulty;
  if (typeof difficulty !== "number") {
    throw new TypeError("The fraction exercise difficulty must be a number");
  }
  if (validatedAssignment.locale !== validatedDocument.locale) {
    throw new RangeError("The assignment locale must match the content locale");
  }
  if (validatedAssignment.requestedItemCount > exercise.count) {
    throw new RangeError(
      `requestedItemCount exceeds the reviewed content limit of ${exercise.count}`,
    );
  }

  const contentHash = await sha256Hex(canonicalizeJson(validatedDocument));
  const { requestedItemCount, ...worksheetAssignment } = validatedAssignment;
  return {
    ...worksheetAssignment,
    itemCount: requestedItemCount,
    difficulty,
    content: {
      id: validatedDocument.id,
      revision: validatedDocument.revision,
      sourceHash: validatedDocument.sourceHash,
      contentHash,
      compilerVersion: validatedDocument.compilerVersion,
      title: validatedDocument.title,
      skillIds: validatedDocument.skills,
      instruction: exercise.instruction,
      attribution: {
        title: validatedDocument.title,
        author: validatedDocument.authors.map((author) => author.name).join(", "),
        sourceUrl: validatedDocument.license.sourceUrl,
        licenseId: validatedDocument.license.licenseId,
        attributionText: validatedDocument.license.attributionText,
        publicationStatus: validatedDocument.publication.status,
        modifications: [],
      },
    },
  };
}

export async function materializeFractionAdditionWorksheetFromContent(
  document: ContentDocumentV1,
  assignment: FractionAdditionAssignmentInput,
): Promise<MaterializedWorksheetInstanceV1> {
  return materializeFractionAdditionWorksheet(
    await fractionAdditionWorksheetInputFromContent(document, assignment),
  );
}

function validateWorksheetInput(
  input: FractionAdditionWorksheetInput,
): FractionAdditionWorksheetInput {
  assertSafeDataObjectGraph(input);
  const validated = FractionAdditionWorksheetInputSchema.parse(input);
  if (validated.content.attribution.publicationStatus !== "draft") {
    throw new RangeError(
      "Published content requires a trusted release approval unavailable in Phase 1",
    );
  }
  if (validated.locale !== "en") {
    throw new RangeError("fractions.add@1 currently supports only the en locale");
  }
  return validated;
}

export class DeterministicGenerationExhaustedError extends Error {
  override readonly name = "DeterministicGenerationExhaustedError";
}

function fractionAdditionPromptSignature(
  generated: GeneratedFractionAdditionV1,
): string {
  return [generated.model.left, generated.model.right]
    .map((value) => `${value.numerator}/${value.denominator}`)
    .sort()
    .join("+");
}

function rationalSignature(value: RationalJson): string {
  return `${value.numerator}/${value.denominator}`;
}

function buildMisconceptions(
  left: RationalJson,
  right: RationalJson,
  answer: RationalJson,
): WorksheetSlotV1["misconceptions"] {
  const candidates = [
    {
      id: "add-denominators",
      description: "Adds both numerators and denominators.",
      incorrectAnswer: createRational(
        BigInt(left.numerator) + BigInt(right.numerator),
        BigInt(left.denominator) + BigInt(right.denominator),
      ),
    },
    {
      id: "keep-first-denominator",
      description: "Adds the numerators without first finding a common denominator.",
      incorrectAnswer: createRational(
        BigInt(left.numerator) + BigInt(right.numerator),
        BigInt(left.denominator),
      ),
    },
  ].filter((candidate) => !equalRationals(candidate.incorrectAnswer, answer));

  if (candidates.length > 0) {
    return candidates;
  }
  return [
    {
      id: "add-one-whole",
      description: "Adds one whole to the correct result.",
      incorrectAnswer: createRational(
        BigInt(answer.numerator) + BigInt(answer.denominator),
        BigInt(answer.denominator),
      ),
    },
  ];
}

function selectCoprimeNumerator(randomWord: number, denominator: number): number {
  const candidates = integerRange(1, denominator - 1).filter(
    (candidate) => greatestCommonDivisor(BigInt(candidate), BigInt(denominator)) === 1n,
  );
  const selected = candidates[randomWord % candidates.length];
  if (selected === undefined) {
    throw new Error("A denominator has no valid proper coprime numerator");
  }
  return selected;
}

function integerRange(minimum: number, maximum: number): number[] {
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function formatFraction(value: RationalJson): string {
  return `\\frac{${value.numerator}}{${value.denominator}}`;
}
