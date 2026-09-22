import { describe, expect, it, vi } from "vitest";
import { planSyllabus } from "../apps/studio/domain/syllabus";
import {
  assertStudioSyllabusContract,
  parseStudioSyntheticArguments,
  runStudioSynthetic,
  type StudioSyntheticFetch,
} from "./smoke-studio-synthetic.js";

const origins = { primary: "https://exercisebook.app", action: "https://learning.new" };
const headers = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const htmlHeaders = {
  ...headers,
  "cache-control": "private, no-store, no-transform",
  "content-type": "text/html",
};

function plan() {
  return {
    schemaVersion: "studio-syllabus-v1",
    saved: false,
    policyVersion: "algebra-foundation-plan@1",
    studyDaysPerWeek: 5,
    id: `syllabus-${"a".repeat(64)}`,
    planHash: "a".repeat(64),
    request: {
      goalId: "linear-equations",
      startingPoint: "from-basics",
      weeks: 2,
      dailyMinutes: 10,
    },
    goal: { id: "linear-equations" },
    startingPoint: { id: "from-basics", evidence: "self-report" },
    skills: [
      {
        id: "signed-add-subtract",
        topicId: "signed-numbers",
        level: "foundation",
        prerequisites: [] as string[],
      },
    ],
    sessions: [1, 4].map((index) => ({
      id: `session-${String(index).padStart(2, "0")}`,
      index,
      week: 1,
      day: index,
      phase: index === 1 ? "introduce" : "review",
      skillId: "signed-add-subtract",
      topicId: "signed-numbers",
      level: "foundation",
      count: 4,
      objective: "符号を確かめる",
      reason: "基礎から取り組みます。",
      budget: {
        lessonMinutes: 1,
        practiceMinutes: 8,
        reflectionMinutes: 1,
        totalMinutes: 10,
      },
      reviewOfSessionId: index === 1 ? null : "session-01",
    })),
    coverage: {
      status: "partial",
      plannedSkillIds: ["signed-add-subtract"],
      remainingSkillIds: ["equation-signed"],
      explanation: "残りの単元は次の計画で扱います。",
    },
    limitations: ["学習履歴は保存されません。"],
  };
}

function contractFetch(
  options: {
    transform?: (response: Response, url: URL) => Promise<Response> | Response;
    syllabus?: unknown;
  } = {},
) {
  return vi.fn<StudioSyntheticFetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    let response: Response;
    if (url.origin === origins.action) {
      response = new Response(null, {
        status: 302,
        headers: { ...headers, location: origins.primary + "/new" },
      });
    } else if (url.pathname === "/new") {
      response = new Response(
        '<!doctype html><html lang="ja"><head><link rel="stylesheet" href="/assets/index-12345678.css"></head><body><div id="root"></div><script type="module" src="/assets/index-12345678.js"></script></body></html>',
        { headers: htmlHeaders },
      );
    } else if (url.pathname.startsWith("/assets/")) {
      response = new Response(
        url.pathname.endsWith(".css") ? "body{}" : 'console.log("app");',
        {
          headers: {
            ...headers,
            "cache-control": "public, max-age=31536000, immutable",
            "content-type": url.pathname.endsWith(".css")
              ? "text/css"
              : "text/javascript",
          },
        },
      );
    } else if (url.pathname === "/api/health") {
      response = Response.json(
        {
          service: "exercisebook-studio",
          status: "ok",
          version: "studio-release-v1",
          releaseId: `studio-rc-${"b".repeat(64)}`,
          capabilities: [
            "syllabus-planning-v1",
            "seeded-workbooks-v1",
            "stored-instance-pdf-v1",
          ],
        },
        { headers },
      );
    } else if (url.pathname === "/studio-api/catalog") {
      response = Response.json(
        {
          topics: ["signed-numbers", "expressions", "equations"].map((id) => ({
            id,
            title: "教材",
            lesson: { rule: "例題を確認します。", steps: [{}] },
          })),
        },
        { headers },
      );
    } else if (url.pathname === "/studio-api/syllabi" && init?.method === "POST") {
      response = Response.json(options.syllabus ?? plan(), { headers });
    } else {
      throw new Error("Unexpected endpoint");
    }
    return options.transform ? await options.transform(response, url) : response;
  });
}

describe("studio production synthetic", () => {
  it("accepts the actual planner output for the scheduled probe conditions", async () => {
    const syllabus = await planSyllabus({
      goalId: "linear-equations",
      startingPoint: "from-basics",
      weeks: 2,
      dailyMinutes: 10,
    });
    expect(() => assertStudioSyllabusContract(syllabus)).not.toThrow();
  });
  it("checks the Japanese application and an unsaved plan without materializing workbooks", async () => {
    const fetchImpl = contractFetch();
    await expect(runStudioSynthetic(origins, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    const writes = fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(origins.primary + "/studio-api/syllabi");
    expect(writes[0]?.[1]).toMatchObject({
      headers: { Origin: origins.primary },
      body: JSON.stringify(plan().request),
    });
    for (const [input, init] of fetchImpl.mock.calls) {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(String(input)).not.toContain("learner=");
      expect(String(input)).not.toContain("/workbooks");
    }
  });

  it.each([
    "http://exercisebook.app",
    "https://user:password@exercisebook.app",
    "https://exercisebook.app/private",
    "https://exercisebook.app/?token=secret",
    "https://exercisebook.app/#fragment",
    "not-a-url",
  ])("rejects unsafe origin %s without echoing credentials", (value) => {
    expect(() =>
      parseStudioSyntheticArguments(["--primary", value, "--action", origins.action]),
    ).toThrow();
    try {
      parseStudioSyntheticArguments(["--primary", value, "--action", origins.action]);
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });

  it("normalizes permitted HTTPS origins", () => {
    expect(
      parseStudioSyntheticArguments([
        "--primary",
        origins.primary + "/",
        "--action",
        origins.action,
      ]),
    ).toEqual(origins);
  });

  it.each([
    "redirect-query",
    "cookie",
    "csp",
    "transform",
    "capabilities",
    "html-fallback",
    "oversized-body",
    "asset-redirect",
  ])("rejects a broken %s boundary", async (failure) => {
    const fetchImpl = contractFetch({
      transform: async (response, url) => {
        if (failure === "redirect-query" && url.origin === origins.action)
          response.headers.set(
            "location",
            origins.primary + "/new?token=synthetic-strip-check",
          );
        if (failure === "cookie" && url.pathname === "/studio-api/catalog")
          response.headers.set("set-cookie", "session=private");
        if (failure === "csp" && url.pathname === "/new")
          response.headers.set(
            "content-security-policy",
            "default-src 'none'; script-src 'self' 'unsafe-inline'",
          );
        if (failure === "transform" && url.pathname === "/new")
          response.headers.set("cache-control", "private, no-store");
        if (failure === "capabilities" && url.pathname === "/api/health")
          return Response.json(
            { ...(await response.json()), capabilities: ["syllabus-planning-v1"] },
            { headers },
          );
        if (failure === "html-fallback" && url.pathname === "/studio-api/syllabi")
          return new Response("<html>fallback</html>", {
            headers: { ...headers, "content-type": "text/html" },
          });
        if (failure === "oversized-body" && url.pathname === "/studio-api/catalog")
          return new Response("x".repeat(128 * 1024 + 1), {
            headers: { ...headers, "content-type": "application/json" },
          });
        if (failure === "asset-redirect" && url.pathname.endsWith(".js"))
          return new Response(null, {
            status: 302,
            headers: { ...headers, location: "https://third-party.example/script.js" },
          });
        return response;
      },
    });
    await expect(runStudioSynthetic(origins, fetchImpl)).rejects.toThrow();
  });

  it("refuses a third-party script before requesting it", async () => {
    const fetchImpl = contractFetch({
      transform: (response, url) =>
        url.pathname === "/new"
          ? new Response(
              '<html lang="ja"><div id="root"></div><script src="https://third-party.example/private.js"></script></html>',
              { headers: htmlHeaders },
            )
          : response,
    });
    await expect(runStudioSynthetic(origins, fetchImpl)).rejects.toThrow(
      "external application asset",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not print the network error message or private response values", async () => {
    await expect(
      runStudioSynthetic(origins, async () => {
        throw new Error("secret-token-123");
      }),
    ).rejects.toThrow("request failed with Error");
    const invalid = plan();
    invalid.goal.id = "secret-token-123";
    await expect(
      runStudioSynthetic(origins, contractFetch({ syllabus: invalid })),
    ).rejects.toThrow("incorrect goal or invented learning evidence");
  });

  it.each([
    "saved",
    "conditions",
    "overrun",
    "sum",
    "order",
    "prerequisite",
    "review",
    "review-gap",
    "review-missing",
    "evidence",
    "identity",
  ])("rejects incoherent syllabus %s", (failure) => {
    const value = plan();
    if (failure === "saved") value.saved = true;
    if (failure === "conditions") value.request.dailyMinutes = 20;
    if (failure === "overrun") value.sessions[0]!.budget.totalMinutes = 11;
    if (failure === "sum") value.sessions[0]!.budget.lessonMinutes = 0;
    if (failure === "order") value.sessions.reverse();
    if (failure === "prerequisite")
      value.skills[0]!.prerequisites.push("substitute-positive");
    if (failure === "review") value.sessions[1]!.reviewOfSessionId = "session-99";
    if (failure === "review-gap") {
      value.sessions[1]!.index = 3;
      value.sessions[1]!.day = 3;
    }
    if (failure === "review-missing") value.sessions[1]!.reviewOfSessionId = null;
    if (failure === "evidence") value.startingPoint.evidence = "mastery";
    if (failure === "identity") value.id = `syllabus-${"c".repeat(64)}`;
    expect(() => assertStudioSyllabusContract(value)).toThrow();
  });
});
