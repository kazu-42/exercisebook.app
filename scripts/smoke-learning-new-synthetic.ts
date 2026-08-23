import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_ACTION_LOCATION = "https://exercisebook.app/new";
const REQUEST_TIMEOUT_MS = 10_000;
const REQUIRED_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export interface SyntheticOrigins {
  readonly primary: string;
  readonly action: string;
}

export type SyntheticFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function runLearningNewSynthetic(
  origins: SyntheticOrigins,
  fetchImpl: SyntheticFetch = fetch,
): Promise<void> {
  const actionRedirect = await checkedFetch(
    fetchImpl,
    `${origins.action}/?token=synthetic&learner=Ada`,
    { redirect: "manual" },
    "action GET /",
  );
  assertStatus(actionRedirect, 302, "action GET /");
  assertHeader(actionRedirect, "location", EXPECTED_ACTION_LOCATION);
  assertNoCookie(actionRedirect, "action GET /");
  assertSecurityHeaders(actionRedirect, "action GET /");

  const primaryRoot = await checkedFetch(
    fetchImpl,
    `${origins.primary}/?learner=Ada`,
    { redirect: "manual" },
    "primary GET /",
  );
  assertStatus(primaryRoot, 302, "primary GET /");
  assertHeader(primaryRoot, "location", "/new");
  assertNoCookie(primaryRoot, "primary GET /");

  const page = await checkedFetch(
    fetchImpl,
    `${origins.primary}/new`,
    undefined,
    "primary GET /new",
  );
  assertStatus(page, 200, "primary GET /new");
  assertSecurityHeaders(page, "primary GET /new");
  assertNoCookie(page, "primary GET /new");
  const pageHtml = await page.text();
  for (const requiredText of [
    "Build a practice preview",
    "This anonymous preview is not saved",
    EXPECTED_ACTION_LOCATION,
  ]) {
    if (!pageHtml.includes(requiredText)) {
      throw new Error(`primary GET /new is missing ${JSON.stringify(requiredText)}`);
    }
  }

  const health = await checkedFetch(
    fetchImpl,
    `${origins.primary}/api/health`,
    undefined,
    "primary GET /api/health",
  );
  assertStatus(health, 200, "primary GET /api/health");
  assertSecurityHeaders(health, "primary GET /api/health");
  assertExactJson(
    await health.json(),
    {
      service: "exercisebook-web",
      status: "ok",
      version: "learning-new-v1",
    },
    "primary health response",
  );

  const preview = await checkedFetch(
    fetchImpl,
    `${origins.primary}/api/plans/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: "exercisebook.daily-plan-preview-request/v1",
        goalId: "math.fractions.add-unlike",
        practiceMinutes: 8,
        localStudyDate: "2026-08-22",
        timeZone: "UTC",
        locale: "en",
      }),
    },
    "primary POST /api/plans/preview",
  );
  assertStatus(preview, 200, "primary POST /api/plans/preview");
  assertSecurityHeaders(preview, "primary POST /api/plans/preview");
  assertNoCookie(preview, "primary POST /api/plans/preview");
  assertPreviewContract(await preview.json());

  const denied = await checkedFetch(
    fetchImpl,
    `${origins.primary}/worksheet/sample/answers`,
    { redirect: "manual" },
    "primary denied prototype route",
  );
  assertStatus(denied, 404, "primary denied prototype route");
  if (denied.headers.has("location")) {
    throw new Error("primary denied prototype route unexpectedly redirected");
  }
}

export function parseSyntheticArguments(
  arguments_: readonly string[],
): SyntheticOrigins {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== "--primary" ||
    arguments_[2] !== "--action"
  ) {
    throw new Error(
      "Usage: smoke-learning-new-synthetic.ts --primary https://PRIMARY --action https://ACTION",
    );
  }
  return {
    primary: parseOrigin(arguments_[1], "primary"),
    action: parseOrigin(arguments_[3], "action"),
  };
}

function parseOrigin(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new Error(`${label} origin is required`);
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must be an HTTPS origin without credentials or path`);
  }
  return url.origin;
}

async function checkedFetch(
  fetchImpl: SyntheticFetch,
  input: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response> {
  try {
    return await fetchImpl(input, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    throw new Error(`${label}: request failed with ${errorName}`);
  }
}

function assertStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(response.status)}`,
    );
  }
}

function assertHeader(response: Response, name: string, expected: string): void {
  const actual = response.headers.get(name);
  if (actual !== expected) {
    throw new Error(
      `${response.url || "response"}: expected ${name}=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertNoCookie(response: Response, label: string): void {
  if (response.headers.has("set-cookie")) {
    throw new Error(`${label} unexpectedly set a cookie`);
  }
}

function assertSecurityHeaders(response: Response, label: string): void {
  for (const [name, expectedPrefix] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    const actual = response.headers.get(name);
    if (actual === null || !actual.startsWith(expectedPrefix)) {
      throw new Error(
        `${label}: expected ${name} to start with ${JSON.stringify(expectedPrefix)}`,
      );
    }
  }
}

function assertExactJson(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an unexpected identity`);
  }
}

function assertPreviewContract(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.plan) || !isRecord(value.worksheet)) {
    throw new Error("primary preview response is not an object contract");
  }
  const items = value.worksheet.items;
  const attributions = value.worksheet.attributions;
  if (
    value.plan.saved !== false ||
    value.plan.itemCount !== 4 ||
    !Array.isArray(items) ||
    items.length !== 4 ||
    !Array.isArray(attributions) ||
    attributions.length !== 1 ||
    !isRecord(attributions[0]) ||
    attributions[0].license !== "CC-BY-4.0"
  ) {
    throw new Error("primary preview response does not match the synthetic contract");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPoint)).href
) {
  const origins = parseSyntheticArguments(process.argv.slice(2));
  await runLearningNewSynthetic(origins);
  process.stdout.write(
    `learning.new synthetic passed\nprimary=${origins.primary}\naction=${origins.action}\n`,
  );
}
