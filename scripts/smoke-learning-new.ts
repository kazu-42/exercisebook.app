import { validateDailyPlanPreviewResponseV1 } from "../apps/web/src/shared/daily-plan-preview-contract.js";

const EXPECTED_ACTION_LOCATION = "https://exercisebook.app/new";
const REQUIRED_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

const { primary, action } = parseArguments(process.argv.slice(2));

const actionRedirect = await fetch(`${action}/?token=synthetic&learner=Ada`, {
  redirect: "manual",
});
assertStatus(actionRedirect, 302, "action GET /");
assertHeader(actionRedirect, "location", EXPECTED_ACTION_LOCATION);
assertNoCookie(actionRedirect, "action GET /");
assertSecurityHeaders(actionRedirect, "action GET /");

const actionHead = await fetch(`${action}/?prompt=private`, {
  method: "HEAD",
  redirect: "manual",
});
assertStatus(actionHead, 302, "action HEAD /");
assertHeader(actionHead, "location", EXPECTED_ACTION_LOCATION);
assertNoCookie(actionHead, "action HEAD /");
if ((await actionHead.text()) !== "") {
  throw new Error("action HEAD / unexpectedly returned a body");
}

const actionPost = await fetch(`${action}/`, {
  method: "POST",
  redirect: "manual",
});
assertStatus(actionPost, 405, "action POST /");
if (actionPost.headers.has("location")) {
  throw new Error("action POST / unexpectedly redirected");
}

const primaryRoot = await fetch(`${primary}/?learner=Ada`, {
  redirect: "manual",
});
assertStatus(primaryRoot, 302, "primary GET /");
assertHeader(primaryRoot, "location", "/new");
assertNoCookie(primaryRoot, "primary GET /");

const primaryRootHead = await fetch(`${primary}/`, {
  method: "HEAD",
  redirect: "manual",
});
assertStatus(primaryRootHead, 302, "primary HEAD /");
assertHeader(primaryRootHead, "location", "/new");
if ((await primaryRootHead.text()) !== "") {
  throw new Error("primary HEAD / unexpectedly returned a body");
}

const page = await fetch(`${primary}/new`);
assertStatus(page, 200, "primary GET /new");
assertSecurityHeaders(page, "primary GET /new");
assertNoCookie(page, "primary GET /new");
const pageHtml = await page.text();
for (const requiredText of [
  "Build a practice preview",
  "This anonymous preview is not saved",
  "https://exercisebook.app/new",
]) {
  if (!pageHtml.includes(requiredText)) {
    throw new Error(`primary GET /new is missing ${JSON.stringify(requiredText)}`);
  }
}

const pageHead = await fetch(`${primary}/new`, { method: "HEAD" });
assertStatus(pageHead, 200, "primary HEAD /new");
assertSecurityHeaders(pageHead, "primary HEAD /new");
if ((await pageHead.text()) !== "") {
  throw new Error("primary HEAD /new unexpectedly returned a body");
}

const health = await fetch(`${primary}/api/health`);
assertStatus(health, 200, "primary GET /api/health");
assertSecurityHeaders(health, "primary GET /api/health");
const healthBody = (await health.json()) as unknown;
if (
  JSON.stringify(healthBody) !==
  JSON.stringify({
    service: "exercisebook-web",
    status: "ok",
    version: "learning-new-v1",
  })
) {
  throw new Error("primary health response has an unexpected identity");
}

const preview = await fetch(`${primary}/api/plans/preview`, {
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
});
assertStatus(preview, 200, "primary POST /api/plans/preview");
assertSecurityHeaders(preview, "primary POST /api/plans/preview");
assertNoCookie(preview, "primary POST /api/plans/preview");
const previewBody = validateDailyPlanPreviewResponseV1(await preview.json());
if (
  previewBody.plan.saved !== false ||
  previewBody.plan.itemCount !== 4 ||
  previewBody.worksheet.items.length !== 4 ||
  previewBody.worksheet.attributions.length !== 1 ||
  previewBody.worksheet.attributions[0]?.license !== "CC-BY-4.0"
) {
  throw new Error("primary preview response does not match the launch contract");
}

for (const deniedPath of [
  "/lessons/fractions/add-unlike-denominators",
  "/worksheet/sample",
  "/worksheet/sample/answers",
  "/api/worksheets/sample",
  "/new?prototype=true",
]) {
  const denied = await fetch(`${primary}${deniedPath}`, { redirect: "manual" });
  assertStatus(denied, 404, `primary GET ${deniedPath}`);
  if (denied.headers.has("location")) {
    throw new Error(`primary GET ${deniedPath} unexpectedly redirected`);
  }
}

process.stdout.write(
  `learning.new remote smoke passed\nprimary=${primary}\naction=${action}\n`,
);

function parseArguments(arguments_: readonly string[]): {
  primary: string;
  action: string;
} {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== "--primary" ||
    arguments_[2] !== "--action"
  ) {
    throw new Error(
      "Usage: smoke-learning-new.ts --primary https://PRIMARY --action https://ACTION",
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
