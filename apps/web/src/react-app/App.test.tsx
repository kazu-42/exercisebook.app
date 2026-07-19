// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerKeyWorksheetFixture,
  studentWorksheetFixture,
} from "@exercisebook/web-renderer/fixtures";

import { App, createBrowserPlanPreviewDefaults } from "./App.js";
import { createDailyPlanPreviewResponseFixture } from "./daily-plan-preview.test-fixture.js";
import {
  DAILY_PLAN_PREVIEW_TIMEOUT_MS,
  type DailyPlanPreviewLoader,
} from "./daily-plan-preview-loader.js";

const planPreviewDefaults = {
  localStudyDate: "2026-07-19",
  timeZone: "Asia/Tokyo",
  locale: "en" as const,
};

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

  it("aborts an in-flight sample request when its page unmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    const pending = deferred<typeof studentWorksheetFixture>();
    const { unmount } = render(
      <App
        initialLocation="/worksheet/sample"
        loadSample={(_variant, signal) => {
          requestSignal = signal;
          return pending.promise;
        }}
      />,
    );

    await act(async () => Promise.resolve());
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(false);

    unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toMatchObject({ name: "AbortError" });
  });

  it("silently cancels a replaced sample variant without showing an error", async () => {
    const answerKey = deferred<typeof answerKeyWorksheetFixture>();
    let studentSignal: AbortSignal | undefined;
    const loadSample = vi.fn((variant, signal: AbortSignal) => {
      if (variant === "answer-key") {
        return answerKey.promise;
      }
      studentSignal = signal;
      return new Promise<typeof studentWorksheetFixture>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const { rerender } = render(
      <App initialLocation="/worksheet/sample" loadSample={loadSample} />,
    );
    await act(async () => Promise.resolve());

    rerender(
      <App initialLocation="/worksheet/sample/answers" loadSample={loadSample} />,
    );
    await act(async () => Promise.resolve());

    expect(studentSignal?.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => answerKey.resolve(answerKeyWorksheetFixture));
    expect(await screen.findByRole("heading", { name: "Answer key" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not let a replaced sample response overwrite the active variant", async () => {
    const student = deferred<typeof studentWorksheetFixture>();
    const answerKey = deferred<typeof answerKeyWorksheetFixture>();
    let studentSignal: AbortSignal | undefined;
    const loadSample = vi.fn((variant, signal: AbortSignal) => {
      if (variant === "student") {
        studentSignal = signal;
        return student.promise;
      }
      return answerKey.promise;
    });
    const { rerender } = render(
      <App initialLocation="/worksheet/sample" loadSample={loadSample} />,
    );
    await act(async () => Promise.resolve());

    rerender(
      <App initialLocation="/worksheet/sample/answers" loadSample={loadSample} />,
    );
    await act(async () => answerKey.resolve(answerKeyWorksheetFixture));
    expect(await screen.findByRole("heading", { name: "Answer key" })).toBeVisible();
    expect(studentSignal?.aborted).toBe(true);

    await act(async () => student.resolve(studentWorksheetFixture));

    expect(screen.getByRole("heading", { name: "Answer key" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never paints a loaded answer key while a student variant is pending", async () => {
    const student = deferred<typeof studentWorksheetFixture>();
    const loadSample = vi.fn((variant: "student" | "answer-key") =>
      variant === "answer-key"
        ? Promise.resolve(answerKeyWorksheetFixture)
        : student.promise,
    );
    const { rerender } = render(
      <App initialLocation="/worksheet/sample/answers" loadSample={loadSample} />,
    );
    expect(await screen.findByRole("heading", { name: "Answer key" })).toBeVisible();
    expect(screen.getAllByText("7/12")[0]).toBeVisible();

    rerender(<App initialLocation="/worksheet/sample" loadSample={loadSample} />);

    expect(
      screen.queryByRole("heading", { name: "Answer key" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("7/12")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparing the fixed sample set",
    );

    await act(async () => student.resolve(studentWorksheetFixture));
    expect(
      await screen.findByRole("heading", {
        name: "Adding fractions with unlike denominators",
      }),
    ).toBeVisible();
    expect(screen.queryByText("7/12")).not.toBeInTheDocument();
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

  it("presents an honest, accessible, unsaved daily-plan preview form", async () => {
    const { container } = render(
      <App initialLocation="/new" planPreviewDefaults={planPreviewDefaults} />,
    );

    expect(
      screen.getByRole("heading", { name: "Build a practice preview" }),
    ).toBeVisible();
    expect(screen.getByText(/not saved/i)).toBeVisible();
    expect(screen.getByText(/does not use your learning history/i)).toBeVisible();
    expect(screen.getByRole("group", { name: "Practice time" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "12 minutes" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Create my preview" })).toBeEnabled();

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  });

  it("derives the explicit local date in the selected IANA time zone", () => {
    expect(
      createBrowserPlanPreviewDefaults(
        new Date("2026-07-19T16:30:00.000Z"),
        "Asia/Tokyo",
      ),
    ).toEqual({
      localStudyDate: "2026-07-20",
      timeZone: "Asia/Tokyo",
      locale: "en",
    });
  });

  it("submits explicit context, announces success, and renders the validated worksheet", async () => {
    globalThis.history.replaceState(null, "", "/new");
    const user = userEvent.setup();
    const pending =
      deferred<ReturnType<typeof createDailyPlanPreviewResponseFixture>>();
    const loader = vi.fn<DailyPlanPreviewLoader>(async () => pending.promise);
    const { container } = render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "8 minutes" }));
    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(
      {
        schema: "exercisebook.daily-plan-preview-request/v1",
        goalId: "math.fractions.add-unlike",
        practiceMinutes: 8,
        localStudyDate: "2026-07-19",
        timeZone: "Asia/Tokyo",
        locale: "en",
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("button", { name: "Creating preview…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparing your fixed practice set",
    );

    pending.resolve(createDailyPlanPreviewResponseFixture(8));

    expect(
      await screen.findByRole("heading", { name: "Your daily preview" }),
    ).toBeVisible();
    const requestedTime = screen.getByText("Requested practice time").closest("div");
    const plannedTime = screen.getByText("Planned practice time").closest("div");
    expect(requestedTime).not.toBeNull();
    expect(plannedTime).not.toBeNull();
    expect(within(requestedTime!).getByText("8 minutes")).toBeVisible();
    expect(within(plannedTime!).getByText("8 minutes")).toBeVisible();
    expect(screen.getByText("4 problems", { selector: "dd" })).toBeVisible();
    expect(screen.getByText(/not a saved or mastery-based plan/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review the fraction lesson" }),
    ).toHaveAttribute("href", "/lessons/fractions/add-unlike-denominators");
    expect(
      screen.getByRole("heading", {
        name: "Add fractions with unlike denominators",
      }),
    ).toBeVisible();
    expect(container.innerHTML).not.toMatch(
      /canonicalAnswer|scoringRule|baseSeed|slotSeed|solutionTrace/u,
    );
    expect(globalThis.location.pathname).toBe("/new");

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  }, 15_000);

  it("keeps the chosen time and exposes an accessible retry after failure", async () => {
    const user = userEvent.setup();
    const loader = vi.fn<DailyPlanPreviewLoader>(async () => {
      throw new Error("offline details that must not be shown");
    });
    const { container } = render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "20 minutes" }));
    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not prepare this preview. Check your connection and try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("offline details");
    expect(screen.getByRole("radio", { name: "20 minutes" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();

    const result = await axe(container);
    expect(result.violations).toEqual([]);
  });

  it("turns a bounded network timeout into an accessible retry state", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }),
    );
    render(<App initialLocation="/new" planPreviewDefaults={planPreviewDefaults} />);

    fireEvent.click(screen.getByRole("button", { name: "Create my preview" }));
    expect(screen.getByRole("button", { name: "Creating preview…" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAILY_PLAN_PREVIEW_TIMEOUT_MS);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not prepare this preview. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("turns a schema-invalid successful loader value into the sanitized error state", async () => {
    const user = userEvent.setup();
    const invalid = structuredClone(
      createDailyPlanPreviewResponseFixture(12),
    ) as unknown as Record<string, unknown>;
    (invalid.plan as Record<string, unknown>).baseSeed = "a".repeat(64);
    const loader = vi.fn<DailyPlanPreviewLoader>(async () => invalid as never);
    const { container } = render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not prepare this preview.",
    );
    expect(container.innerHTML).not.toContain("baseSeed");
    expect(
      screen.queryByRole("heading", { name: "Your daily preview" }),
    ).not.toBeInTheDocument();
  });

  it("aborts stale work and never lets an older response overwrite a new choice", async () => {
    const user = userEvent.setup();
    const first = deferred<ReturnType<typeof createDailyPlanPreviewResponseFixture>>();
    const second = deferred<ReturnType<typeof createDailyPlanPreviewResponseFixture>>();
    const signals: AbortSignal[] = [];
    const loader = vi.fn<DailyPlanPreviewLoader>(async (_request, signal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "8 minutes" }));
    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    await user.click(screen.getByRole("radio", { name: "20 minutes" }));
    expect(signals[0]?.aborted).toBe(true);
    await user.click(screen.getByRole("button", { name: "Create my preview" }));

    second.resolve(createDailyPlanPreviewResponseFixture(20));
    const plannedTimeLabel = await screen.findByText("Planned practice time");
    expect(
      within(plannedTimeLabel.closest("div")!).getByText("16 minutes"),
    ).toBeVisible();
    expect(screen.getByText("8 problems", { selector: "dd" })).toBeVisible();

    first.resolve(createDailyPlanPreviewResponseFixture(8));
    await Promise.resolve();
    expect(
      screen.queryByText("4 problems", { selector: "dd" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("8 problems", { selector: "dd" })).toBeVisible();
  });

  it("aborts an active request on unmount", async () => {
    const user = userEvent.setup();
    const pending =
      deferred<ReturnType<typeof createDailyPlanPreviewResponseFixture>>();
    let signal: AbortSignal | undefined;
    const loader = vi.fn<DailyPlanPreviewLoader>(async (_request, nextSignal) => {
      signal = nextSignal;
      return pending.promise;
    });
    const { unmount } = render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("prints the already-loaded worksheet without another request", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const loader = vi.fn<DailyPlanPreviewLoader>(async () =>
      createDailyPlanPreviewResponseFixture(12),
    );
    render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    await user.click(await screen.findByRole("button", { name: "Print this set" }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("clears a loaded set when its selected budget changes", async () => {
    globalThis.history.replaceState(null, "", "/new");
    const user = userEvent.setup();
    const loader = vi.fn<DailyPlanPreviewLoader>(async () =>
      createDailyPlanPreviewResponseFixture(12),
    );
    render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    expect(
      await screen.findByRole("heading", { name: "Your daily preview" }),
    ).toBeVisible();

    await user.click(screen.getByRole("radio", { name: "20 minutes" }));

    expect(
      screen.queryByRole("heading", { name: "Your daily preview" }),
    ).not.toBeInTheDocument();
    expect(globalThis.location.pathname).toBe("/new");
  });

  it("keeps an unsaved preview on the create route without mutating history", async () => {
    globalThis.history.replaceState(null, "", "/new");
    const user = userEvent.setup();
    const pushState = vi.spyOn(globalThis.history, "pushState");
    const replaceState = vi.spyOn(globalThis.history, "replaceState");
    const loader = vi.fn<DailyPlanPreviewLoader>(async () =>
      createDailyPlanPreviewResponseFixture(12),
    );
    render(
      <App
        initialLocation="/new"
        loadPlanPreview={loader}
        planPreviewDefaults={planPreviewDefaults}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create my preview" }));
    expect(
      await screen.findByRole("heading", { name: "Your daily preview" }),
    ).toBeVisible();

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(globalThis.location.pathname).toBe("/new");
  });
});
