const sourceInstanceHash =
  "75a0ccab1fba9b1a6ea1eb04a45f847fe25ec46291ddde6e67b92af73c68cad0";

const commonBlocks = [
  {
    type: "heading",
    id: "worksheet-title",
    level: 1,
    content: [{ type: "text", text: "Adding fractions with unlike denominators" }],
  },
  {
    type: "paragraph",
    id: "worksheet-introduction",
    content: [
      {
        type: "text",
        text: "Rename each fraction with a common denominator, then add.",
      },
    ],
  },
  {
    type: "worked-example",
    id: "worked-example-1",
    title: "Worked example",
    prompt: [
      {
        type: "fraction",
        numerator: "1",
        denominator: "2",
        accessibleText: "one half",
      },
      { type: "operator", symbol: "+", accessibleText: "plus" },
      {
        type: "fraction",
        numerator: "1",
        denominator: "3",
        accessibleText: "one third",
      },
    ],
    steps: [
      [
        {
          type: "text",
          text: "Use 6 as a common denominator.",
        },
      ],
      [
        {
          type: "text",
          text: "Rename the fractions, then add to get ",
        },
        {
          type: "fraction",
          numerator: "5",
          denominator: "6",
          accessibleText: "five sixths",
        },
        { type: "text", text: "." },
      ],
    ],
  },
  {
    type: "problem-group",
    id: "practice-problems",
    title: "Practice",
    problems: [
      {
        id: "fraction-add-01",
        ordinal: 1,
        instruction: "Add and simplify.",
        promptAccessibleText: "one fourth plus one third",
        prompt: [
          {
            type: "fraction",
            numerator: "1",
            denominator: "4",
            accessibleText: "one fourth",
          },
          { type: "operator", symbol: "+", accessibleText: "plus" },
          {
            type: "fraction",
            numerator: "1",
            denominator: "3",
            accessibleText: "one third",
          },
        ],
        response: {
          type: "fraction",
          label: "Your response for problem 1",
          lines: 3,
        },
        provenance: {
          contentId: "math.fractions.add-unlike-denominators",
          contentRevision: 1,
          sourceHash:
            "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
          contentHash:
            "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
          compilerVersion: "exercisebook-content-compiler/1",
          generatorId: "fractions.add",
          generatorVersion: "1",
          generationAttempt: 0,
        },
      },
      {
        id: "fraction-add-02",
        ordinal: 2,
        instruction: "Add and simplify.",
        promptAccessibleText: "two fifths plus one half",
        prompt: [
          {
            type: "fraction",
            numerator: "2",
            denominator: "5",
            accessibleText: "two fifths",
          },
          { type: "operator", symbol: "+", accessibleText: "plus" },
          {
            type: "fraction",
            numerator: "1",
            denominator: "2",
            accessibleText: "one half",
          },
        ],
        response: {
          type: "fraction",
          label: "Your response for problem 2",
          lines: 3,
        },
        provenance: {
          contentId: "math.fractions.add-unlike-denominators",
          contentRevision: 1,
          sourceHash:
            "79e734ec88fd0f5803c3063645726fb6934522a78ef79523112abd16dd3b78bb",
          contentHash:
            "336ce8c164c92f836f3ba6ab2f3c1ed0b7230433b950c8c39e6f01ce84d1fbb5",
          compilerVersion: "exercisebook-content-compiler/1",
          generatorId: "fractions.add",
          generatorVersion: "1",
          generationAttempt: 0,
        },
      },
    ],
  },
  {
    type: "fraction-bar",
    id: "fraction-bar-fallback",
    label: "Static fraction bars showing one fourth and one third for problem 1",
    caption: "Use the bars to find a common denominator.",
    bars: [
      {
        numerator: 1,
        denominator: 4,
        label: "one fourth",
      },
      {
        numerator: 1,
        denominator: 3,
        label: "one third",
      },
    ],
  },
  {
    type: "working-space",
    id: "working-space-1",
    label: "Working space",
    lines: 5,
  },
  {
    type: "page-break",
    id: "page-break-before-attribution",
  },
] as const;

const commonDocument = {
  schema: "exercisebook.print/v1",
  sourceInstanceHash,
  projectorVersion: "print-projector.v1",
  paper: "a4",
  locale: "en",
  title: "Adding fractions with unlike denominators",
  blocks: commonBlocks,
  attributions: [
    {
      id: "exercisebook-original",
      title: "Adding fractions with unlike denominators",
      author: "Exercise Book",
      sourceUrl:
        "https://exercisebook.app/content/en/math/fractions/add-unlike-denominators",
      licenseId: "LicenseRef-Proprietary-Draft",
      attributionText: "Exercise Book original lesson",
      publicationStatus: "draft",
      modifications: [],
    },
  ],
} as const;

export const studentPrintDocumentFixture = {
  ...commonDocument,
  variant: "student",
} as const;

export const answerKeyPrintDocumentFixture = {
  ...commonDocument,
  variant: "answer-key",
  blocks: [
    ...commonBlocks,
    {
      type: "answer-key",
      id: "key-fraction-add-01",
      problemId: "fraction-add-01",
      ordinal: 1,
      canonicalResponse: [
        {
          type: "fraction",
          numerator: "7",
          denominator: "12",
          accessibleText: "seven twelfths",
        },
      ],
      explanation: [
        "The least common denominator is 12.",
        "Rename 1/4 as 3/12 and 1/3 as 4/12.",
        "Add 3/12 + 4/12 to get 7/12.",
      ],
    },
    {
      type: "answer-key",
      id: "key-fraction-add-02",
      problemId: "fraction-add-02",
      ordinal: 2,
      canonicalResponse: [
        {
          type: "fraction",
          numerator: "9",
          denominator: "10",
          accessibleText: "nine tenths",
        },
      ],
      explanation: [
        "The least common denominator is 10.",
        "Rename 2/5 as 4/10 and 1/2 as 5/10.",
        "Add 4/10 + 5/10 to get 9/10.",
      ],
    },
  ],
} as const;

export const canonicalAnswerLeakMarkers = [
  "7/12",
  "seven twelfths",
  "The least common denominator is 12.",
  "3/12 + 4/12",
  "9/10",
  "nine tenths",
  "The least common denominator is 10.",
  "4/10 + 5/10",
] as const;
