# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright==1.63.0"]
# ///
"""Worker workbook journey: real API/PDFs, recovery, keyboard, and privacy."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def capture(page, destination):
    # Full-page capture otherwise paints fixed navigation at the scrolled offset.
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(destination), full_page=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4180")
    parser.add_argument("--output", default="output/studio-browser")
    parser.add_argument("--axe", type=Path)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        health = context.request.get(args.base_url + "/api/health")
        assert health.status == 200, health.status
        health_body = health.json()
        assert health_body["service"] == "exercisebook-studio", health_body
        assert health_body["status"] == "ok", health_body
        assert health_body["version"] == "studio-release-v1", health_body
        assert re.fullmatch(r"studio-rc-[a-f0-9]{64}", health_body["releaseId"])
        assert "no-store" in health.headers["cache-control"]
        page = context.new_page()
        errors = []
        external = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "request",
            lambda req: (
                external.append(req.url)
                if urlparse(req.url).hostname
                not in (None, urlparse(args.base_url).hostname)
                else None
            ),
        )
        response = page.goto(args.base_url)
        assert response is not None and response.status == 200
        assert "default-src 'none'" in response.headers["content-security-policy"]
        assert response.headers["x-content-type-options"] == "nosniff"
        page.get_by_role("button", name="問題集をつくる", exact=True).click()
        page.get_by_role("radio", name=re.compile("一次方程式")).wait_for()
        capture(page, output / "desktop-create.png")
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
        if args.axe:
            # DevTools evaluation leaves the shipped CSP unchanged. Injecting a
            # script element would be blocked by the intentional strict policy.
            page.evaluate(args.axe.read_text())
            violations = page.evaluate("async () => (await axe.run()).violations")
            (output / "axe-create.json").write_text(
                json.dumps(violations, ensure_ascii=False, indent=2)
            )
            assert not violations, [
                (item["id"], len(item["nodes"])) for item in violations
            ]

        page.get_by_role("button", name=re.compile("^体験版")).first.click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Tab")
        assert page.evaluate(
            "document.querySelector('dialog').contains(document.activeElement)"
        )
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)

        page.get_by_role("radio", name=re.compile("4問")).check()
        create_button = page.get_by_role("button", name="この内容で問題集をつくる")
        create_button.focus()
        page.keyboard.press("Enter")
        answer = page.get_by_role("textbox", name="問題1の答え", exact=True)
        answer.wait_for()
        expect(page.get_by_role("textbox")).to_have_count(4)
        assert page.locator(".answer-explanation").count() == 0
        answer.fill("4")
        page.get_by_role("textbox", name="問題2の答え", exact=True).fill("wrong")
        capture(page, output / "desktop-study.png")

        def unavailable(route):
            route.fulfill(
                status=503,
                content_type="application/json",
                body='{"error":"Temporarily unavailable"}',
            )

        pdf_route = re.compile(r"/studio-api/workbooks/[^/]+/pdf\?")
        page.route(pdf_route, unavailable)
        page.get_by_role("button", name="問題PDF", exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text("PDFを作成できませんでした")
        expect(answer).to_have_value("4")
        expect(answer).to_be_enabled()
        expect(page.get_by_role("textbox")).to_have_count(4)
        page.unroute(pdf_route, unavailable)

        for variant, label in (("student", "問題PDF"), ("answers", "解答PDF")):
            with page.expect_download(timeout=45000) as download_info:
                with page.expect_response(
                    lambda response: "/studio-api/workbooks/" in response.url
                    and response.url.endswith("/pdf?variant=" + variant),
                    timeout=45000,
                ) as response_info:
                    page.get_by_role("button", name=label, exact=True).click()
                response = response_info.value
                (output / (variant + "-response.json")).write_text(
                    json.dumps(
                        {
                            "variant": variant,
                            "status": response.status,
                            "contentType": response.headers.get("content-type"),
                            "cacheControl": response.headers.get("cache-control"),
                        }
                    )
                    + "\n"
                )
                if response.status != 200:
                    capture(page, output / (variant + "-failure.png"))
                assert response.status == 200, f"{variant} PDF returned {response.status}"
            download = download_info.value
            target = output / (variant + ".pdf")
            download.save_as(target)
            assert target.read_bytes().startswith(b"%PDF-")
        expect(answer).to_have_value("4")

        grade_route = re.compile(r"/studio-api/workbooks/[^/]+/grade$")
        page.route(grade_route, unavailable)
        page.get_by_role("button", name="答え合わせをする").click()
        expect(page.get_by_role("alert")).to_contain_text(
            "答え合わせができませんでした"
        )
        expect(answer).to_have_value("4")
        expect(answer).to_be_enabled()
        expect(page.locator(".answer-explanation")).to_have_count(0)
        page.unroute(grade_route, unavailable)
        page.get_by_role("button", name="答え合わせをする").click()
        page.locator(".result-summary").wait_for()
        expect(page.locator(".answer-explanation")).to_have_count(4)
        expect(page.get_by_text("入力を確認", exact=True)).to_have_count(1)
        capture(page, output / "desktop-review.png")
        page.get_by_role("button", name="もう一度取り組む").click()
        expect(answer).to_be_enabled()

        page.get_by_role("button", name="教材をみる", exact=True).click()
        expect(page.locator(".lesson-card")).to_have_count(3)
        page.locator("summary").first.click()
        capture(page, output / "desktop-library.png")
        page.get_by_role("button", name="今日の学習", exact=True).click()
        page.get_by_role("button", name="続きから取り組む").click()
        expect(answer).to_have_value("4")

        create_route = re.compile(r"/studio-api/workbooks$")
        page.route(create_route, unavailable)
        page.get_by_role("button", name="問題集をつくる", exact=True).click()
        page.get_by_role("button", name="この内容で問題集をつくる").click()
        expect(page.get_by_role("alert")).to_contain_text(
            "問題集を準備できませんでした"
        )
        page.get_by_role("button", name="今日の学習", exact=True).click()
        page.get_by_role("button", name="続きから取り組む").click()
        expect(answer).to_have_value("4")
        expect(page.get_by_role("textbox")).to_have_count(4)
        page.unroute(create_route, unavailable)
        assert context.cookies() == []
        assert page.evaluate("localStorage.length + sessionStorage.length") == 0

        for width in (390, 320):
            page.set_viewport_size({"width": width, "height": 844})
            page.get_by_role("button", name="問題集をつくる", exact=True).click()
            assert not page.evaluate(
                "document.documentElement.scrollWidth > innerWidth"
            ), width
            capture(page, output / ("mobile-create-" + str(width) + ".png"))
            page.get_by_role("radio", name=re.compile("正負の数")).check()
            page.get_by_role("radio", name=re.compile("標準に挑戦")).check()
            page.get_by_role("radio", name=re.compile("8問")).check()
            create_button = page.get_by_role("button", name="この内容で問題集をつくる")
            create_button.focus()
            page.keyboard.press("Enter")
            expect(page.get_by_role("textbox")).to_have_count(8)
            expect(page.locator(".study-heading h1")).to_be_focused()
            page.get_by_role("textbox", name="問題1の答え", exact=True).focus()
            page.keyboard.press("Tab")
            expect(
                page.get_by_role("textbox", name="問題2の答え", exact=True)
            ).to_be_focused()
            assert not page.evaluate(
                "document.documentElement.scrollWidth > innerWidth"
            ), width
            capture(page, output / ("mobile-study-" + str(width) + ".png"))
        assert not errors, errors
        assert not external, external
        print(
            json.dumps(
                {
                    "journey": "passed",
                    "releaseId": health_body["releaseId"],
                    "screenshots": str(output),
                    "pdfs": 2,
                    "consoleErrors": errors,
                    "externalRequests": external,
                    "viewportWidths": [1440, 390, 320],
                    "recovery": ["pdf-503", "grade-503", "create-503"],
                },
                ensure_ascii=False,
            )
        )
        browser.close()


if __name__ == "__main__":
    main()
