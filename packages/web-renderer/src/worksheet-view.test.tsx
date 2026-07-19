// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { answerKeyWorksheetFixture, studentWorksheetFixture } from "./fixtures.js";
import { WorksheetView } from "./worksheet-view.js";

afterEach(cleanup);

describe("WorksheetView", () => {
  it("renders the student problem IDs and order without answer or solution data", () => {
    const { container } = render(<WorksheetView worksheet={studentWorksheetFixture} />);

    const problems = screen.getAllByRole("group", { name: /Problem \d/ });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toHaveAttribute("data-problem-id", "fraction-add-01");
    expect(problems[1]).toHaveAttribute("data-problem-id", "fraction-add-02");
    expect(screen.getByLabelText("Your answer for problem 1")).toBeVisible();
    expect(container.textContent).not.toContain("7/12");
    expect(container.textContent).not.toContain("The least common denominator is 12.");
    expect(container.innerHTML).not.toContain("data-answer");
    expect(container.innerHTML).not.toContain("data-solution");
    expect(container.innerHTML).not.toContain("canonicalAnswer");
  });

  it("renders a clearly marked answer key from the same instance hash", () => {
    render(<WorksheetView worksheet={answerKeyWorksheetFixture} />);

    expect(screen.getByRole("heading", { name: "Answer key" })).toBeInTheDocument();
    expect(screen.getAllByText("7/12")[0]).toBeVisible();
    expect(screen.getAllByText("9/10")[0]).toBeVisible();
    expect(screen.getByTestId("instance-hash")).toHaveTextContent(
      answerKeyWorksheetFixture.instanceHash,
    );
  });

  it("labels each fraction as one mathematical expression", () => {
    render(<WorksheetView worksheet={studentWorksheetFixture} />);

    const first = screen.getByRole("group", { name: "Problem 1" });
    expect(
      within(first).getByLabelText("one fourth plus one third"),
    ).toBeInTheDocument();
  });

  it("has no automatic accessibility violations", async () => {
    const { container } = render(<WorksheetView worksheet={studentWorksheetFixture} />);

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  });
});
