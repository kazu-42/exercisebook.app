"""Browser smoke for the production-shaped learning.new V1 primary Worker."""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("LAUNCH_BASE_URL", "http://127.0.0.1:5173")
OUTPUT_DIRECTORY = Path("output/browser-smoke")


def assert_status(actual: int, expected: int, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, received {actual}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 1000},
        color_scheme="light",
    )
    page = context.new_page()
    page.set_default_timeout(10_000)
    page.set_default_navigation_timeout(15_000)
    console_errors: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("requestfailed", lambda request: failed_requests.append(request.url))

    print("checking route matrix", flush=True)
    root = context.request.get(
        f"{BASE_URL}/?learner=Ada", max_redirects=0, timeout=10_000
    )
    assert_status(root.status, 302, "GET /")
    if root.headers.get("location") != "/new":
        raise AssertionError("GET / did not drop the query and redirect to /new")

    for denied_path in (
        "/lessons/fractions/add-unlike-denominators",
        "/worksheet/sample",
        "/worksheet/sample/answers",
        "/api/worksheets/sample",
        "/new?prototype=true",
    ):
        denied = context.request.get(f"{BASE_URL}{denied_path}", timeout=10_000)
        assert_status(denied.status, 404, f"GET {denied_path}")

    health = context.request.get(f"{BASE_URL}/api/health", timeout=10_000)
    assert_status(health.status, 200, "GET /api/health")
    if health.json() != {
        "service": "exercisebook-web",
        "status": "ok",
        "version": "learning-new-v1",
    }:
        raise AssertionError("Health response does not identify learning-new-v1")

    print("checking interactive preview", flush=True)
    page.goto(f"{BASE_URL}/new", wait_until="networkidle")
    page.get_by_role("heading", name="Build a practice preview").wait_for()
    if page.locator('a[href*="/lessons/"], a[href*="/worksheet/sample"]').count():
        raise AssertionError("The launch page exposed a prototype navigation link")

    page.get_by_role("radio", name="8 minutes").focus()
    page.keyboard.press("Space")
    page.get_by_role("button", name="Create my preview").focus()
    page.keyboard.press("Enter")
    page.get_by_role("heading", name="Your daily preview").wait_for()
    page.get_by_text("CC-BY-4.0", exact=False).wait_for()

    rendered_text = page.locator("body").inner_text()
    for protected_token in (
        "canonicalAnswer",
        "scoringRule",
        "solutionTrace",
        "baseSeed",
        "slotSeed",
        "repository-owner",
        "learning-new-launch-2026-08-22",
    ):
        if protected_token in rendered_text:
            raise AssertionError(f"Public DOM exposed protected token {protected_token}")

    if awaitable_databases := page.evaluate("indexedDB.databases()"):
        raise AssertionError(f"Anonymous preview created IndexedDB state: {awaitable_databases}")
    if page.evaluate("Object.keys(localStorage).length") != 0:
        raise AssertionError("Anonymous preview wrote localStorage")
    if page.evaluate("Object.keys(sessionStorage).length") != 0:
        raise AssertionError("Anonymous preview wrote sessionStorage")
    if context.cookies():
        raise AssertionError("Anonymous preview set cookies")

    print("capturing desktop, mobile, and print screenshots", flush=True)
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(OUTPUT_DIRECTORY / "learning-new-v1-desktop.png"),
        full_page=True,
    )
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(
        path=str(OUTPUT_DIRECTORY / "learning-new-v1-mobile.png"),
        full_page=True,
    )
    page.set_viewport_size({"width": 794, "height": 1123})
    page.emulate_media(media="print")
    page.screenshot(
        path=str(OUTPUT_DIRECTORY / "learning-new-v1-print.png"),
        full_page=True,
    )

    if console_errors:
        raise AssertionError(f"Browser console errors: {console_errors}")
    if page_errors:
        raise AssertionError(f"Browser page errors: {page_errors}")
    if failed_requests:
        raise AssertionError(f"Browser request failures: {failed_requests}")

    print("learning.new V1 browser smoke passed")
    browser.close()
