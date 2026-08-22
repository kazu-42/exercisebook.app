// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LaunchApp } from "./LaunchApp.js";
import { createDailyPlanPreviewResponseFixture } from "./daily-plan-preview.test-fixture.js";
import type { DailyPlanPreviewLoader } from "./daily-plan-preview-loader.js";
import type { DailyPlanPreviewResponseV1 } from "../shared/daily-plan-preview-contract.js";

const planPreviewDefaults = {
  localStudyDate: "2026-08-22",
  timeZone: "Asia/Tokyo",
  locale: "en" as const,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("learning.new V1 launch app", () => {
  it("renders only the anonymous unsaved one-lesson creation surface", async () => {
    const { container } = render(
      <LaunchApp
        loadPlanPreview={vi.fn<DailyPlanPreviewLoader>()}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Build a practice preview" }),
    ).toBeVisible();
    expect(screen.getByText(/not saved/iu)).toBeVisible();
    expect(screen.getByText(/does not use your learning history/iu)).toBeVisible();
    expect(
      screen.getByRole("option", {
        name: "Add fractions with unlike denominators",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /lesson|sample|answer/iu })).toBeNull();
    expect(container.innerHTML).not.toMatch(
      /\/lessons\/|\/worksheet\/sample|answer-key|marketing/iu,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("creates one bounded public preview and offers same-instance printing", async () => {
    const user = userEvent.setup();
    const response = createDailyPlanPreviewResponseFixture(8);
    const loader = vi.fn<DailyPlanPreviewLoader>(async () => response);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { container } = render(
      <LaunchApp loadPlanPreview={loader} planPreviewDefaults={planPreviewDefaults} />,
    );

    await user.click(screen.getByRole("radio", { name: "8 minutes" }));
    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    expect(loader).toHaveBeenCalledWith(
      {
        schema: "exercisebook.daily-plan-preview-request/v1",
        goalId: "math.fractions.add-unlike",
        practiceMinutes: 8,
        localStudyDate: "2026-08-22",
        timeZone: "Asia/Tokyo",
        locale: "en",
      },
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByRole("heading", { name: "Your daily preview" }),
    ).toBeVisible();
    const saved = screen.getByText("Saved").closest("div");
    expect(saved).not.toBeNull();
    expect(within(saved!).getByText("No")).toBeVisible();
    expect(container.textContent).toContain("CC-BY-4.0");
    expect(container.innerHTML).not.toMatch(
      /canonicalAnswer|scoringRule|baseSeed|slotSeed|solutionTrace/u,
    );

    await user.click(screen.getByRole("button", { name: "Print this set" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect((await axe(container)).violations).toEqual([]);
  }, 15_000);

  it("keeps failures sanitized and retryable", async () => {
    const user = userEvent.setup();
    const loader = vi.fn<DailyPlanPreviewLoader>(async () => {
      throw new Error("private infrastructure details");
    });
    const { container } = render(
      <LaunchApp loadPlanPreview={loader} planPreviewDefaults={planPreviewDefaults} />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not prepare this preview. Check your connection and try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "private infrastructure details",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("aborts a pending request and ignores its stale result after the budget changes", async () => {
    const user = userEvent.setup();
    let resolvePreview: ((response: DailyPlanPreviewResponseV1) => void) | undefined;
    const loader = vi.fn<DailyPlanPreviewLoader>(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    render(
      <LaunchApp loadPlanPreview={loader} planPreviewDefaults={planPreviewDefaults} />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    const signal = loader.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);

    await user.click(screen.getByRole("radio", { name: "8 minutes" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Create my preview" })).toBeEnabled();

    await act(async () => {
      resolvePreview?.(createDailyPlanPreviewResponseFixture(12));
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Your daily preview" })).toBeNull();
  });
});
