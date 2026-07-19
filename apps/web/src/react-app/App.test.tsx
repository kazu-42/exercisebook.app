// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import {
  answerKeyWorksheetFixture,
  studentWorksheetFixture,
} from "@exercisebook/web-renderer/fixtures";

import { App } from "./App.js";

afterEach(cleanup);

describe("Exercise Book app", () => {
  it("presents a focused English landing page with direct sample actions", () => {
    render(<App initialLocation="/" />);

    expect(
      screen.getByRole("heading", {
        name: "A new exercise book, every day.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Try the fraction lesson" }),
    ).toHaveAttribute("href", "/lessons/fractions/add-unlike-denominators");
    expect(screen.getByText("No account needed")).toBeVisible();
  });

  it("renders the unlike-denominator lesson and interactive fraction bars", () => {
    render(<App initialLocation="/lessons/fractions/add-unlike-denominators" />);

    expect(
      screen.getByRole("heading", {
        name: "Add fractions by renaming them",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Choose a common denominator" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Practice with today’s set" }),
    ).toHaveAttribute("href", "/worksheet/sample");
  });

  it("loads the student worksheet without fetching or regenerating in the renderer", async () => {
    render(
      <App
        initialLocation="/worksheet/sample"
        loadSample={async () => studentWorksheetFixture}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Adding fractions with unlike denominators",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open print view" })).toHaveAttribute(
      "href",
      "/worksheet/sample/print?variant=student",
    );
  });

  it("loads the answer-key route as an explicit variant", async () => {
    render(
      <App
        initialLocation="/worksheet/sample/answers"
        loadSample={async (variant) =>
          variant === "answer-key" ? answerKeyWorksheetFixture : studentWorksheetFixture
        }
      />,
    );

    expect(await screen.findByRole("heading", { name: "Answer key" })).toBeVisible();
  });

  it("shows a recoverable error when the sample endpoint is unavailable", async () => {
    render(
      <App
        initialLocation="/worksheet/sample"
        loadSample={async () => {
          throw new Error("offline");
        }}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sample worksheet could not be loaded.",
    );
    expect(screen.getByRole("link", { name: "Return to the lesson" })).toHaveAttribute(
      "href",
      "/lessons/fractions/add-unlike-denominators",
    );
  });

  it("fails closed when an endpoint returns the wrong projection variant", async () => {
    render(
      <App
        initialLocation="/worksheet/sample"
        loadSample={async () => answerKeyWorksheetFixture}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sample worksheet could not be loaded.",
    );
    expect(screen.queryByText("7/12")).not.toBeInTheDocument();
  });

  it("has no automatic accessibility violations on the lesson", async () => {
    const { container } = render(
      <App initialLocation="/lessons/fractions/add-unlike-denominators" />,
    );

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  });
});
