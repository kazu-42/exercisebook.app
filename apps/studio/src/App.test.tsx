// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Topic, Workbook } from "./contracts";
import { axe } from "jest-axe";
import { parseCatalog, readResponseJson } from "./response-validation";

const topic: Topic = {
  id: "equations",
  number: "03",
  title: "一次方程式",
  subtitle: "等式の性質",
  description: "両辺に同じ操作をして、文字の値を求めます。",
  prerequisite: "正負の数と文字式",
  sample: "3x + 5 = 20",
  lesson: {
    title: "等式の性質",
    rule: "両辺に同じ操作をします。",
    example: "2x + 3 = 11",
    steps: [
      {
        relation: "equivalent-equation",
        math: "2x = 8",
        reason: "両辺から 3 をひきます。解は変わりません。",
      },
      {
        relation: "equivalent-equation",
        math: "x = 4",
        reason: "両辺を 2 でわります。2 は 0 でないので、解は変わりません。",
      },
      {
        relation: "verification",
        math: "2 × 4 + 3 = 11",
        reason: "x = 4 を元の方程式に代入して確かめます。",
      },
    ],
  },
};
const workbook: Workbook = {
  schemaVersion: "studio-workbook-v1",
  saved: false,
  id: `draft-${"a".repeat(64)}`,
  instanceHash: "a".repeat(64),
  topicId: "equations",
  level: "foundation",
  count: 4,
  title: "一次方程式",
  levelLabel: "基礎",
  minutes: 8,
  reason: "一次方程式の基礎を4問練習します。",
  lesson: topic.lesson,
  items: Array.from({ length: 4 }, (_, i) => ({
    id: `q-${i + 1}`,
    prompt: "3x + 5 = 20",
    instruction: "x の値を求めなさい。",
  })),
};

function jsonResponse(value: unknown): Response {
  // Node's Response.json produces Node-realm bytes under jsdom. Browser fetch
  // and this mock instead expose byte chunks from the consumer's own realm.
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

function mockApi(failPdf = false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/catalog")) return jsonResponse({ topics: [topic] });
    if (url.includes("/pdf"))
      return new Response("error", { status: failPdf ? 503 : 200 });
    if (url.endsWith("/grade"))
      return jsonResponse({
        workbookId: workbook.id,
        correctCount: 1,
        total: 4,
        items: workbook.items.map((item, i) => ({
          id: item.id,
          status: i === 0 ? "correct" : "unanswered",
          submitted: i === 0 ? "5" : "",
          answer: "5",
          steps: [
            {
              relation: "equivalent-equation",
              math: "3x = 15",
              reason: "両辺から 5 をひきます。解は変わりません。",
            },
            {
              relation: "equivalent-equation",
              math: "x = 5",
              reason: "両辺を 3 でわります。3 は 0 でないので、解は変わりません。",
            },
            {
              relation: "verification",
              math: "3 × 5 + 5 = 20",
              reason: "x = 5 を元の方程式に代入して確かめます。",
            },
          ],
        })),
      });
    return jsonResponse(workbook);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openCreation() {
  await userEvent.click(await screen.findByRole("button", { name: "問題集をつくる" }));
  await screen.findByRole("radio", { name: /一次方程式/ });
}

it("reads the catalog fixture through the bounded JSON reader", async () => {
  expect(parseCatalog({ topics: [topic] })).toEqual({ topics: [topic] });
  expect(await readResponseJson(jsonResponse({ topics: [topic] }))).toEqual({
    topics: [topic],
  });
});

it("provides an accessible creation form", async () => {
  mockApi();
  const { container } = render(<App />);
  await openCreation();
  expect((await axe(container)).violations).toEqual([]);
});

it("ignores an old PDF failure after creating another workbook", async () => {
  const fallback = mockApi();
  let failPdf: (response: Response) => void = () => {
    throw new Error("PDF not requested");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/pdf"))
        return new Promise<Response>((resolve) => {
          failPdf = resolve;
        });
      return fallback(input);
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await openCreation();
  await user.click(screen.getByRole("radio", { name: /4問/ }));
  await user.click(screen.getByRole("button", { name: "この内容で問題集をつくる" }));
  await screen.findByRole("textbox", { name: "問題1の答え" });
  await user.click(screen.getByRole("button", { name: "問題PDF" }));
  await user.click(screen.getByRole("button", { name: "問題集をつくる" }));
  await user.click(screen.getByRole("button", { name: "この内容で問題集をつくる" }));
  await screen.findByRole("textbox", { name: "問題1の答え" });
  expect(screen.getByRole("button", { name: "問題PDF" })).toBeEnabled();
  await act(async () => failPdf(new Response("failed", { status: 503 })));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("lets a learner create, answer, and review a set without claiming saved mastery", async () => {
  const api = mockApi();
  const user = userEvent.setup();
  render(<App />);
  await openCreation();
  await user.click(screen.getByRole("radio", { name: /4問/ }));
  await user.click(screen.getByRole("button", { name: "この内容で問題集をつくる" }));
  await screen.findByRole("textbox", { name: "問題1の答え" });
  expect(api.mock.calls.some(([url]) => String(url).endsWith("/grade"))).toBe(false);
  await user.type(screen.getByRole("textbox", { name: "問題1の答え" }), "5");
  await user.click(screen.getByRole("button", { name: "答え合わせをする" }));
  await screen.findByText("4問中1問正解");
  expect(screen.getAllByText("両辺から 5 をひきます。解は変わりません。")).toHaveLength(
    4,
  );
  expect(screen.getAllByText("解の変わらない変形")).toHaveLength(10);
  expect(screen.getAllByText("元の方程式で確認")).toHaveLength(5);
  expect(screen.getAllByText("3x = 15")).toHaveLength(4);
  expect(screen.getByText("2x = 8")).toBeInTheDocument();
  expect(screen.queryByText(/→|考え方のヒント/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/保存しません/).length).toBeGreaterThan(0);
});

it("preserves the worksheet and answers when PDF generation fails", async () => {
  mockApi(true);
  const user = userEvent.setup();
  render(<App />);
  await openCreation();
  await user.click(screen.getByRole("radio", { name: /4問/ }));
  await user.click(screen.getByRole("button", { name: "この内容で問題集をつくる" }));
  await user.type(await screen.findByRole("textbox", { name: "問題1の答え" }), "5");
  await user.click(screen.getByRole("button", { name: "問題PDF" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PDF"));
  expect(screen.getByRole("textbox", { name: "問題1の答え" })).toHaveValue("5");
  expect(screen.getByRole("button", { name: "答え合わせをする" })).toBeEnabled();
});

it("preserves answers after a malformed grade response and allows a successful retry", async () => {
  const fallback = mockApi();
  let rejectFirstGrade = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const response = await fallback(input);
      if (String(input).endsWith("/grade") && rejectFirstGrade) {
        rejectFirstGrade = false;
        const result = (await readResponseJson(response)) as Record<string, unknown>;
        return jsonResponse({ ...result, workbookId: `draft-${"b".repeat(64)}` });
      }
      return response;
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await openCreation();
  await user.click(screen.getByRole("radio", { name: /4問/ }));
  await user.click(screen.getByRole("button", { name: "この内容で問題集をつくる" }));
  await user.type(await screen.findByRole("textbox", { name: "問題1の答え" }), "5");
  await user.click(screen.getByRole("button", { name: "答え合わせをする" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "答え合わせができませんでした",
  );
  expect(screen.getByRole("textbox", { name: "問題1の答え" })).toHaveValue("5");
  expect(screen.queryByText("4問中1問正解")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "答え合わせをする" }));
  await screen.findByText("4問中1問正解");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
