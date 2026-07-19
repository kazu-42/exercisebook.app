import type { WebWorksheet } from "./model.js";

export const studentWorksheetFixture = {
  schemaVersion: "web-worksheet.v1",
  instanceHash: "75a0ccab1fba9b1a6ea1eb04a45f847fe25ec46291ddde6e67b92af73c68cad0",
  assignmentId: "assignment-fractions-001",
  title: "Adding fractions with unlike denominators",
  skillTitle: "Fraction addition",
  studyDate: "2026-07-19",
  locale: "en",
  expectedMinutes: 12,
  variant: "student",
  introduction:
    "Rename each fraction with a common denominator, then add the numerators.",
  workedExample: {
    left: { numerator: "1", denominator: "2" },
    right: { numerator: "1", denominator: "3" },
    result: { numerator: "5", denominator: "6" },
    steps: [
      "The least common denominator of 2 and 3 is 6.",
      "Rename 1/2 as 3/6 and 1/3 as 2/6.",
      "Add 3/6 + 2/6 to get 5/6.",
    ],
  },
  items: [
    {
      id: "fraction-add-01",
      ordinal: 1,
      prompt: {
        kind: "fraction-addition",
        left: { numerator: "1", denominator: "4" },
        right: { numerator: "1", denominator: "3" },
        accessibleText: "one fourth plus one third",
      },
      responseLabel: "Your answer for problem 1",
      printFallback: "Write one fraction in the answer space.",
    },
    {
      id: "fraction-add-02",
      ordinal: 2,
      prompt: {
        kind: "fraction-addition",
        left: { numerator: "2", denominator: "5" },
        right: { numerator: "1", denominator: "2" },
        accessibleText: "two fifths plus one half",
      },
      responseLabel: "Your answer for problem 2",
      printFallback: "Write one fraction in the answer space.",
    },
  ],
  attributions: [
    {
      label: "Exercise Book original lesson",
      license: "LicenseRef-ExerciseBook-Draft",
    },
  ],
} satisfies WebWorksheet;

export const answerKeyWorksheetFixture = {
  ...studentWorksheetFixture,
  variant: "answer-key",
  items: [
    {
      ...studentWorksheetFixture.items[0]!,
      answer: {
        numerator: "7",
        denominator: "12",
        accessibleText: "seven twelfths",
      },
      solution: [
        "The least common denominator is 12.",
        "Rename 1/4 as 3/12 and 1/3 as 4/12.",
        "Add 3/12 + 4/12 to get 7/12.",
      ],
    },
    {
      ...studentWorksheetFixture.items[1]!,
      answer: {
        numerator: "9",
        denominator: "10",
        accessibleText: "nine tenths",
      },
      solution: [
        "The least common denominator is 10.",
        "Rename 2/5 as 4/10 and 1/2 as 5/10.",
        "Add 4/10 + 5/10 to get 9/10.",
      ],
    },
  ],
} satisfies WebWorksheet;
