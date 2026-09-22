// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { planSyllabus } from "../domain/syllabus";
import { SyllabusBuilder } from "./SyllabusBuilder";
import type { SyllabusRequest } from "./syllabus-contracts";

const request: SyllabusRequest = {
  goalId: "linear-equations",
  startingPoint: "from-basics",
  weeks: 4,
  dailyMinutes: 15,
};

function jsonResponse(value: unknown): Response {
  const bytes = Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function mockApi() {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
    return jsonResponse(await planSyllabus(JSON.parse(String(options?.body))));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for explicit creation and sends the chosen goal, experience and time budget", async () => {
  const api = mockApi();
  const user = userEvent.setup();
  const changed = vi.fn();
  render(
    <SyllabusBuilder
      busy={false}
      onStartSession={async () => {}}
      onPlanChange={changed}
    />,
  );
  expect(api).not.toHaveBeenCalled();
  await user.click(screen.getByRole("radio", { name: /文字式の値を求める/ }));
  await user.click(screen.getByRole("radio", { name: /少し学んだことがある/ }));
  await user.click(screen.getByRole("radio", { name: "6週間" }));
  await user.click(screen.getByRole("radio", { name: "10分" }));
  await user.click(screen.getByRole("button", { name: "この条件で学習計画をつくる" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const expected = {
    goalId: "expression-values",
    startingPoint: "some-familiarity",
    weeks: 6,
    dailyMinutes: 10,
  } as const;
  expect(api).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(api.mock.calls[0]?.[1]?.body))).toEqual(expected);
  expect(
    screen.getByRole("heading", { name: (await planSyllabus(expected)).title }),
  ).toHaveFocus();
  expect(screen.getByText(/サーバーに保存されません/)).toBeInTheDocument();
}, 15_000);

it("shows week-specific sessions and starts the precise selected session", async () => {
  const user = userEvent.setup();
  const plan = await planSyllabus(request);
  const start = vi.fn(async () => {});
  render(<SyllabusBuilder initialPlan={plan} busy={false} onStartSession={start} />);
  await user.click(screen.getByRole("button", { name: "2週目" }));
  expect(screen.getByRole("button", { name: "2週目" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const week = screen.getByRole("region", { name: "2週目の学習計画" });
  const session = plan.sessions.find((entry) => entry.week === 2)!;
  await user.click(
    within(week).getByRole("button", {
      name: `2週目・${session.day}日目の学習を始める`,
    }),
  );
  expect(start).toHaveBeenCalledWith(session);
}, 15_000);

it("keeps the prior plan on a mismatched response and recovers on retry", async () => {
  const user = userEvent.setup();
  const plan = await planSyllabus(request);
  const api = mockApi();
  api.mockResolvedValueOnce(jsonResponse(await planSyllabus({ ...request, weeks: 2 })));
  const changed = vi.fn();
  render(
    <SyllabusBuilder
      initialPlan={plan}
      busy={false}
      onStartSession={async () => {}}
      onPlanChange={changed}
    />,
  );
  await user.click(screen.getByRole("button", { name: "この条件で計画を組み直す" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "条件と前の計画は残っています",
  );
  expect(screen.getByRole("heading", { name: plan.title })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "4週間" })).toBeChecked();
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "この条件で計画を組み直す" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}, 15_000);

it("prevents repeated starts and keeps the plan after a failed workbook request", async () => {
  const user = userEvent.setup();
  let reject: (error: Error) => void = () => {};
  const start = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(
    <SyllabusBuilder
      initialPlan={await planSyllabus(request)}
      busy={false}
      onStartSession={start}
    />,
  );
  const button = screen.getByRole("button", { name: "1週目・1日目の学習を始める" });
  await user.click(button);
  expect(button).toBeDisabled();
  await user.click(button);
  expect(start).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Service unavailable")));
  expect(await screen.findByRole("alert")).toHaveTextContent("学習計画は残っています");
  expect(button).toBeEnabled();
}, 15_000);

it("prints every week with the course layout and cleans up print state", async () => {
  const user = userEvent.setup();
  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(document.documentElement).toHaveClass("syllabus-printing");
    expect(
      document.querySelectorAll(".syllabus-print-only .syllabus-week"),
    ).toHaveLength(4);
  });
  render(
    <SyllabusBuilder
      initialPlan={await planSyllabus(request)}
      busy={false}
      onStartSession={async () => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "計画を印刷" }));
  expect(print).toHaveBeenCalledOnce();
  expect(document.documentElement).not.toHaveClass("syllabus-printing");
});

it("offers accessible conditions and a generated weekly plan", async () => {
  const { container } = render(
    <SyllabusBuilder
      initialPlan={await planSyllabus(request)}
      busy={false}
      onStartSession={async () => {}}
    />,
  );
  expect((await axe(container)).violations).toEqual([]);
}, 20_000);

it("aborts a pending planning request when the view unmounts", async () => {
  const user = userEvent.setup();
  let signal: AbortSignal | undefined;
  const api = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", api);
  const { unmount } = render(
    <SyllabusBuilder busy={false} onStartSession={async () => {}} />,
  );
  await user.click(screen.getByRole("button", { name: "この条件で学習計画をつくる" }));
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});
