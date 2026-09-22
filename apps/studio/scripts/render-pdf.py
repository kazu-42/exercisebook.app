"""Render bounded, self-contained studio HTML with an offline local browser.

Setup: uv run --no-project --with playwright==1.63.0 playwright install chromium
The TypeScript adapter supplies the process deadline and output limit.
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

MAX_INPUT_BYTES = 512 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
FONT_DIRECTORY = Path(__file__).resolve().parents[1] / "assets/fonts/noto-sans-jp"
FONT_SHA256 = "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
LICENSE_SHA256 = "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9"


def bundled_font_css() -> str:
    """Fail closed on missing or modified assets; never select a system font."""
    font = (FONT_DIRECTORY / "NotoSansJP-wght.ttf").read_bytes()
    license_text = (FONT_DIRECTORY / "OFL.txt").read_bytes()
    metadata = json.loads(
        (FONT_DIRECTORY / "metadata.json").read_text(encoding="utf-8")
    )
    if (
        len(font) != 9_589_900
        or hashlib.sha256(font).hexdigest() != FONT_SHA256
        or hashlib.sha256(license_text).hexdigest() != LICENSE_SHA256
        or metadata.get("sha256") != FONT_SHA256
        or metadata.get("licenseSha256") != LICENSE_SHA256
        or metadata.get("license") != "OFL-1.1"
    ):
        raise ValueError(
            "The bundled Noto font or its license failed integrity verification."
        )
    data = base64.b64encode(font).decode("ascii")
    return (
        '@font-face { font-family: "Workbook Noto Sans JP"; '
        f'src: url("data:font/ttf;base64,{data}") format("truetype"); '
        "font-style: normal; font-weight: 100 900; font-display: block; }"
    )


def verify_custom_fonts(context, page) -> None:
    """Inspect actual glyph rendering so a missing glyph cannot use an OS font."""
    session = context.new_cdp_session(page)
    try:
        session.send("DOM.enable")
        session.send("CSS.enable")
        root = session.send("DOM.getDocument")["root"]["nodeId"]
        nodes = session.send(
            "DOM.querySelectorAll", {"nodeId": root, "selector": "body, body *"}
        )["nodeIds"]
        used_fonts = []
        for node_id in nodes:
            fonts = session.send("CSS.getPlatformFontsForNode", {"nodeId": node_id})[
                "fonts"
            ]
            used_fonts.extend(font for font in fonts if font["glyphCount"] > 0)
        if not used_fonts or any(
            not font["isCustomFont"]
            or not font["postScriptName"].startswith("NotoSansJP-")
            for font in used_fonts
        ):
            raise ValueError(
                "The print document used an unpinned font or an unsupported glyph."
            )
    finally:
        session.detach()


def main() -> None:
    source = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if not source or len(source) > MAX_INPUT_BYTES:
        raise ValueError("The print document is empty or exceeds 512 KiB.")
    html = source.decode("utf-8", errors="strict")
    if html.count("</head>") != 1:
        raise ValueError("The print document must contain a single head boundary.")
    html = html.replace("</head>", f"<style>{bundled_font_css()}</style></head>", 1)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            timeout=15_000,
            args=[
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-domain-reliability",
                "--disable-sync",
                "--no-first-run",
                "--host-resolver-rules=MAP * ~NOTFOUND",
            ],
        )
        try:
            context = browser.new_context(
                java_script_enabled=False,
                offline=True,
                service_workers="block",
                locale="ja-JP",
                timezone_id="Asia/Tokyo",
            )
            attempted_requests: list[str] = []

            def deny_request(route) -> None:
                attempted_requests.append(route.request.resource_type)
                route.abort("blockedbyclient")

            context.route("**/*", deny_request)
            page = context.new_page()
            page.set_default_timeout(10_000)
            page.emulate_media(media="print")
            page.set_content(html, wait_until="load", timeout=10_000)
            page.evaluate("document.fonts.ready")
            loaded = page.evaluate("""async () => {
                const faces = await document.fonts.load('400 12px "Workbook Noto Sans JP"', '数学 x − × ÷');
                return faces.length > 0 && faces.every(face => face.status === 'loaded');
            }""")
            if not loaded:
                raise ValueError("The bundled Noto font failed to load.")
            verify_custom_fonts(context, page)
            if attempted_requests:
                raise ValueError("Print documents must not request external resources.")
            layout = page.evaluate("""() => {
              const sheets = [...document.querySelectorAll('.sheet')];
              return {
                pages: sheets.length,
                overflow: sheets.some(sheet => sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1),
                clipped: [...document.querySelectorAll('.problem-grid, .answer-list, .problem-card, .solution-card, .lesson')].some(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1),
              };
            }""")
            if not 1 <= layout["pages"] <= 2 or layout["overflow"] or layout["clipped"]:
                raise ValueError(
                    "The print document exceeds its validated page layout."
                )
            pdf = page.pdf(
                format="A4",
                prefer_css_page_size=True,
                print_background=True,
                display_header_footer=False,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                tagged=True,
            )
            if len(pdf) > MAX_OUTPUT_BYTES or not pdf.startswith(b"%PDF-"):
                raise ValueError("The rendered PDF is invalid or exceeds 16 MiB.")
            sys.stdout.buffer.write(pdf)
            sys.stdout.buffer.flush()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except (PlaywrightError, OSError, ValueError) as error:
        print(f"PDF rendering failed: {error}", file=sys.stderr)
        sys.exit(1)
