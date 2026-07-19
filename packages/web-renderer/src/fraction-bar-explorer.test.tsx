// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { FractionBarExplorer } from "./fraction-bar-explorer.js";

afterEach(cleanup);

describe("FractionBarExplorer", () => {
  it("offers a native keyboard-operable choice and explains a correct choice", async () => {
    const user = userEvent.setup();
    render(<FractionBarExplorer />);

    const six = screen.getByRole("radio", {
      name: "6",
    });

    six.focus();
    await user.keyboard("[Space]");

    expect(six).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Exactly. 1/2 becomes 3/6 and 1/3 becomes 2/6.",
    );
  });

  it("gives a useful retry cue without marking an incorrect choice as correct", async () => {
    const user = userEvent.setup();
    render(<FractionBarExplorer />);

    await user.click(screen.getByRole("radio", { name: "5" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Not yet. Both 2 and 3 must divide evenly into the denominator.",
    );
  });

  it("keeps an explicit non-interactive and print fallback in the document", () => {
    render(<FractionBarExplorer />);

    expect(screen.getByText(/Draw six equal boxes/)).toHaveTextContent(
      "1/2 = 3/6 and 1/3 = 2/6",
    );
  });

  it("has no automatic accessibility violations", async () => {
    const { container } = render(<FractionBarExplorer />);

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  });
});
