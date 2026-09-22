import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ACTION_LOCATION = "https://exercisebook.app/new";
const TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 128 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ASSET = /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;
const TOPICS = ["signed-numbers", "expressions", "equations"];
const CAPABILITIES = [
  "syllabus-planning-v1",
  "seeded-workbooks-v1",
  "stored-instance-pdf-v1",
];
const CONDITIONS = {
  goalId: "linear-equations",
  startingPoint: "from-basics",
  weeks: 2,
  dailyMinutes: 10,
} as const;

export interface StudioSyntheticOrigins {
  readonly primary: string;
  readonly action: string;
}

export type StudioSyntheticFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
  );
}

function secure(response: Response, label: string, noStore = true): void {
  check(!response.headers.has("set-cookie"), `${label}: unexpected cookie`);
  check(
    response.headers.get("referrer-policy") === "no-referrer",
    `${label}: unsafe referrer policy`,
  );
  check(
    response.headers.get("x-content-type-options") === "nosniff",
    `${label}: missing nosniff`,
  );
  const policy = response.headers.get("content-security-policy") ?? "";
  check(
    policy.split(";").some((directive) => directive.trim() === "default-src 'none'"),
    `${label}: missing restrictive CSP`,
  );
  check(!/\b(?:unsafe-inline|unsafe-eval)\b/.test(policy), `${label}: unsafe CSP`);
  if (noStore) {
    check(
      (response.headers.get("cache-control") ?? "")
        .split(",")
        .some((value) => value.trim() === "no-store"),
      `${label}: missing no-store`,
    );
  }
}

async function readText(
  response: Response,
  maximum: number,
  label: string,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  check(
    contentLength === null ||
      (/^\d+$/.test(contentLength) && Number(contentLength) <= maximum),
    `${label}: oversized response`,
  );
  check(response.body !== null, `${label}: empty response body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let reads = 0; reads < 4096; reads += 1) {
      const { done, value } = await reader.read();
      if (done) {
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error(`${label}: invalid UTF-8`);
        }
      }
      total += value.byteLength;
      check(total <= maximum, `${label}: oversized response`);
      chunks.push(value);
    }
    throw new Error(`${label}: excessive response chunks`);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function json(response: Response, label: string): Promise<unknown> {
  check(
    response.headers.get("content-type")?.split(";", 1)[0] === "application/json",
    `${label}: expected JSON`,
  );
  const source = await readText(response, MAX_JSON_BYTES, label);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
}

function pageAssets(html: string): string[] {
  check(
    /<html\b[^>]*\blang=["']ja["']/i.test(html),
    "primary page: missing Japanese language",
  );
  check(
    /<div\b[^>]*\bid=["']root["']/i.test(html),
    "primary page: missing application root",
  );
  const paths = new Set<string>();
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const script = match[1]?.toLowerCase() === "script";
    if (!script && !/\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag)) continue;
    const value = new RegExp(
      `\\b${script ? "src" : "href"}=["']([^"']+)["']`,
      "i",
    ).exec(tag)?.[1];
    check(
      value !== undefined && ASSET.test(value),
      "primary page: unexpected or external application asset",
    );
    paths.add(value);
  }
  check(
    paths.size >= 2 &&
      paths.size <= 8 &&
      [...paths].some((path) => path.endsWith(".js")) &&
      [...paths].some((path) => path.endsWith(".css")),
    "primary page: incomplete application assets",
  );
  return [...paths].sort();
}

function catalogContract(value: unknown): void {
  check(
    record(value) && Array.isArray(value.topics) && value.topics.length === 3,
    "catalog: invalid topic inventory",
  );
  const ids = new Set<string>();
  for (const topic of value.topics) {
    check(
      record(topic) &&
        typeof topic.id === "string" &&
        TOPICS.includes(topic.id) &&
        !ids.has(topic.id),
      "catalog: invalid or duplicate topic",
    );
    check(
      nonempty(topic.title) &&
        record(topic.lesson) &&
        nonempty(topic.lesson.rule) &&
        Array.isArray(topic.lesson.steps) &&
        topic.lesson.steps.length > 0,
      "catalog: incomplete lesson",
    );
    ids.add(topic.id);
  }
}

export function assertStudioSyllabusContract(value: unknown): void {
  check(
    record(value) &&
      value.schemaVersion === "studio-syllabus-v1" &&
      value.saved === false &&
      value.policyVersion === "algebra-foundation-plan@1" &&
      value.studyDaysPerWeek === 5,
    "syllabus: invalid or durable planning contract",
  );
  check(
    typeof value.planHash === "string" &&
      HASH.test(value.planHash) &&
      value.id === `syllabus-${value.planHash}`,
    "syllabus: missing or inconsistent plan identity",
  );
  check(
    record(value.request) &&
      Object.keys(value.request).length === 4 &&
      Object.entries(CONDITIONS).every(
        ([key, expected]) => value.request![key] === expected,
      ),
    "syllabus: conditions changed",
  );
  check(
    record(value.goal) &&
      value.goal.id === CONDITIONS.goalId &&
      record(value.startingPoint) &&
      value.startingPoint.id === CONDITIONS.startingPoint &&
      value.startingPoint.evidence === "self-report",
    "syllabus: incorrect goal or invented learning evidence",
  );
  check(
    Array.isArray(value.skills) && value.skills.length > 0 && value.skills.length <= 6,
    "syllabus: missing skill inventory",
  );
  const skills = new Map<string, Record<string, unknown>>();
  for (const skill of value.skills) {
    check(
      record(skill) &&
        nonempty(skill.id) &&
        !skills.has(skill.id) &&
        typeof skill.topicId === "string" &&
        TOPICS.includes(skill.topicId) &&
        ["foundation", "standard"].includes(String(skill.level)) &&
        Array.isArray(skill.prerequisites),
      "syllabus: invalid skill inventory",
    );
    skills.set(skill.id, skill);
  }
  check(
    Array.isArray(value.sessions) &&
      value.sessions.length > 0 &&
      value.sessions.length <= CONDITIONS.weeks * 5,
    "syllabus: empty or excessive session count",
  );
  const ids = new Map<string, { index: number; skillId: unknown }>();
  const encounteredSkills = new Set<string>();
  let previousIndex = 0;
  for (const session of value.sessions) {
    check(
      record(session) &&
        nonempty(session.id) &&
        !ids.has(session.id) &&
        integer(session.index, 1, 10) &&
        session.index > previousIndex,
      "syllabus: duplicate or reordered session",
    );
    check(
      session.week === Math.floor((session.index - 1) / 5) + 1 &&
        session.day === ((session.index - 1) % 5) + 1,
      "syllabus: inconsistent study-day position",
    );
    const skill =
      typeof session.skillId === "string" ? skills.get(session.skillId) : undefined;
    check(
      skill && skill.topicId === session.topicId && skill.level === session.level,
      "syllabus: unresolved session skill",
    );
    check(
      (skill.prerequisites as unknown[]).every(
        (id) => typeof id === "string" && encounteredSkills.has(id),
      ),
      "syllabus: missing prior prerequisite",
    );
    check(
      ["introduce", "practice", "review", "checkpoint"].includes(
        String(session.phase),
      ) &&
        nonempty(session.objective) &&
        nonempty(session.reason),
      "syllabus: missing session teaching purpose",
    );
    check(
      session.count === 4 && record(session.budget),
      "syllabus: invalid problem count or budget",
    );
    const budget = session.budget;
    check(
      integer(budget.lessonMinutes, 0, 10) &&
        integer(budget.practiceMinutes, 0, 10) &&
        integer(budget.reflectionMinutes, 0, 10) &&
        integer(budget.totalMinutes, 1, 10),
      "syllabus: invalid or overrun budget",
    );
    check(
      budget.lessonMinutes + budget.practiceMinutes + budget.reflectionMinutes ===
        budget.totalMinutes && budget.practiceMinutes >= session.count * 2,
      "syllabus: incoherent session budget",
    );
    const reviewed =
      typeof session.reviewOfSessionId === "string"
        ? ids.get(session.reviewOfSessionId)
        : undefined;
    check(
      session.reviewOfSessionId === null ||
        (reviewed !== undefined &&
          reviewed.index <= session.index - 3 &&
          reviewed.skillId === session.skillId),
      "syllabus: invalid review reference",
    );
    check(
      (session.phase !== "review" && session.phase !== "checkpoint") ||
        reviewed !== undefined,
      "syllabus: review or checkpoint without prior practice",
    );
    ids.set(session.id, { index: session.index, skillId: session.skillId });
    encounteredSkills.add(String(session.skillId));
    previousIndex = session.index;
  }
  check(
    record(value.coverage) &&
      ["planned", "partial"].includes(String(value.coverage.status)) &&
      Array.isArray(value.coverage.plannedSkillIds) &&
      Array.isArray(value.coverage.remainingSkillIds) &&
      nonempty(value.coverage.explanation),
    "syllabus: missing coverage boundary",
  );
  check(
    Array.isArray(value.limitations) &&
      value.limitations.length > 0 &&
      value.limitations.every(nonempty),
    "syllabus: missing limitations",
  );
}

export async function runStudioSynthetic(
  origins: StudioSyntheticOrigins,
  fetchImpl: StudioSyntheticFetch = fetch,
): Promise<void> {
  async function get(
    path: string,
    label: string,
    init: RequestInit = {},
    expected = 200,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(path, {
        ...init,
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new Error(
        `${label}: request failed with ${error instanceof Error ? error.name : "UnknownError"}`,
      );
    }
    check(
      response.status === expected,
      `${label}: expected ${expected}, got ${response.status}`,
    );
    return response;
  }

  // Deliberately fictional sentinel; never use real tokens or learner data.
  const action = await get(
    `${origins.action}/?token=synthetic-strip-check`,
    "action redirect",
    {},
    302,
  );
  check(
    action.headers.get("location") === ACTION_LOCATION,
    "action redirect: incorrect destination or forwarded query",
  );
  secure(action, "action redirect");
  await action.body?.cancel();

  const page = await get(`${origins.primary}/new`, "primary page");
  secure(page, "primary page");
  check(
    (page.headers.get("cache-control") ?? "")
      .split(",")
      .some((value) => value.trim() === "no-transform"),
    "primary page: missing no-transform",
  );
  check(
    page.headers.get("content-type")?.split(";", 1)[0] === "text/html",
    "primary page: expected HTML",
  );
  const assets = pageAssets(await readText(page, 64 * 1024, "primary page"));
  for (const path of assets) {
    const asset = await get(origins.primary + path, "application asset");
    secure(asset, "application asset", false);
    const type = asset.headers.get("content-type")?.split(";", 1)[0];
    check(
      path.endsWith(".css")
        ? type === "text/css"
        : type === "text/javascript" || type === "application/javascript",
      "application asset: incorrect MIME type",
    );
    check(
      (await readText(asset, 2 * 1024 * 1024, "application asset")).trim().length > 0,
      "application asset: empty file",
    );
  }

  const health = await get(`${origins.primary}/api/health`, "primary health");
  secure(health, "primary health");
  const identity = await json(health, "primary health");
  check(
    record(identity) &&
      identity.service === "exercisebook-studio" &&
      identity.status === "ok" &&
      identity.version === "studio-release-v1" &&
      typeof identity.releaseId === "string" &&
      /^studio-rc-[a-f0-9]{64}$/.test(identity.releaseId),
    "primary health: incorrect release identity",
  );
  check(
    Array.isArray(identity.capabilities) &&
      CAPABILITIES.every((capability) => identity.capabilities!.includes(capability)),
    "primary health: required capability unavailable",
  );

  const catalog = await get(`${origins.primary}/studio-api/catalog`, "primary catalog");
  secure(catalog, "primary catalog");
  catalogContract(await json(catalog, "primary catalog"));

  // Planning is explicitly unsaved. Never start a session in this scheduled
  // probe: that endpoint materializes a new immutable workbook in storage.
  const syllabus = await get(
    `${origins.primary}/studio-api/syllabi`,
    "primary syllabus",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origins.primary },
      body: JSON.stringify(CONDITIONS),
    },
  );
  secure(syllabus, "primary syllabus");
  assertStudioSyllabusContract(await json(syllabus, "primary syllabus"));
}

export function parseStudioSyntheticArguments(
  arguments_: readonly string[],
): StudioSyntheticOrigins {
  check(
    arguments_.length === 4 &&
      arguments_[0] === "--primary" &&
      arguments_[2] === "--action",
    "Usage: smoke-studio-synthetic.ts --primary https://PRIMARY --action https://ACTION",
  );
  const parse = (value: string | undefined, label: string): string => {
    check(typeof value === "string", `${label}: origin is required`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label}: invalid origin`);
    }
    check(
      url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "",
      `${label}: expected credential-free HTTPS origin without path`,
    );
    return url.origin;
  };
  return {
    primary: parse(arguments_[1], "primary"),
    action: parse(arguments_[3], "action"),
  };
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPoint)).href
) {
  try {
    const origins = parseStudioSyntheticArguments(process.argv.slice(2));
    await runStudioSynthetic(origins);
    process.stdout.write("studio production synthetic passed\n");
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "studio synthetic failed"}\n`,
    );
    process.exitCode = 1;
  }
}
