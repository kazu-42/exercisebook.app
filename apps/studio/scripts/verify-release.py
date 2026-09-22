# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf==1.26.7"]
# ///
"""Verify every immutable release PDF and export representative review images.

Run from the repository root with:
    uv run --no-project apps/studio/scripts/verify-release.py

This is a build-time inspection tool, not part of the shipped application.
"""

import argparse
import hashlib
import itertools
import json
import re
import unicodedata
from pathlib import Path

import pymupdf

TOPICS = ("signed-numbers", "expressions", "equations")
LEVELS = ("foundation", "standard")
COUNTS = (4, 6, 8)
VARIANTS = ("student", "answers")
RELATION_LABELS = {
    "expression-equality": "同じ値の式",
    "equivalent-equation": "解の変わらない変形",
    "substitution": "値の代入",
    "verification": "元の方程式で確認",
}


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def normalized(text: str) -> str:
    """Ignore layout whitespace, while preserving equality/implication symbols."""
    return re.sub(r"[\s\u200b\ufeff]+", "", unicodedata.normalize("NFKC", text))


def assert_order(text: str, fragments: list[str], label: str) -> None:
    cursor = 0
    for fragment in fragments:
        wanted = normalized(fragment)
        check(bool(wanted), f"{label}: empty expected text")
        position = text.find(wanted, cursor)
        check(position >= 0, f"{label}: missing or reordered text: {fragment}")
        cursor = position + len(wanted)


def student_public_fragments(workbook: dict) -> list[str]:
    lesson = workbook["lesson"]
    return [
        workbook["title"],
        workbook["levelLabel"],
        lesson["title"],
        lesson["rule"],
        lesson["example"],
        *(item["prompt"] for item in workbook["items"]),
        *(item["instruction"] for item in workbook["items"]),
        *(step["math"] for step in lesson["steps"]),
        *(step["reason"] for step in lesson["steps"]),
        *RELATION_LABELS.values(),
    ]


def assert_no_answer_trace(text: str, workbook: dict, answers: list[dict]) -> None:
    allowed = [normalized(fragment) for fragment in student_public_fragments(workbook)]
    for answer in answers:
        for step in answer["steps"]:
            for fragment in (step["math"], step["reason"]):
                candidate = normalized(fragment)
                # Individual numbers legitimately occur in prompts and examples.
                # Compare complete distinctive traces, never bare answer tokens.
                if len(candidate) < 3 or re.fullmatch(r"[+−-]?\d+", candidate):
                    continue
                if any(candidate in public for public in allowed):
                    continue
                check(
                    candidate not in text,
                    f"Student PDF leaks answer trace for {answer['id']}: {fragment}",
                )


def verify_fonts(document: pymupdf.Document, page: pymupdf.Page) -> set[str]:
    names = set()
    fonts = page.get_fonts(full=True)
    check(bool(fonts), "PDF page contains no inspectable fonts")
    for font in fonts:
        xref, _, font_type, name = font[:4]
        if font_type == "Type3":
            # Chromium may embed variable-font glyphs as Type3 outlines. Their
            # names live in FontDescriptor, rather than a BaseFont/FontFile.
            name_type, name = document.xref_get_key(xref, "FontDescriptor/FontName")
            check(name_type == "name", "Type3 font has no verifiable font name")
            kind, glyphs = document.xref_get_key(xref, "CharProcs")
            glyph_refs = re.findall(r"\b(\d+) 0 R", glyphs)
            check(
                kind == "dict" and bool(glyph_refs), "Type3 font has no embedded glyphs"
            )
            check(
                all(document.xref_stream(int(ref)) for ref in glyph_refs),
                "Type3 font has an empty or unavailable glyph outline",
            )
            kind, unicode_ref = document.xref_get_key(xref, "ToUnicode")
            check(
                kind == "xref"
                and bool(document.xref_stream(int(unicode_ref.split()[0]))),
                "Type3 font has no embedded Unicode mapping",
            )
        else:
            _, extension, _, font_bytes = document.extract_font(xref)
            check(bool(font_bytes), f"PDF font is not embedded: {name}")
            check(
                extension in {"ttf", "otf", "cff"},
                f"Unexpected font format: {extension}",
            )
        name = re.sub(r"^[A-Z]{6}\+", "", name.lstrip("/"))
        check(name.startswith("NotoSansJP"), f"Unapproved PDF font: {name}")
        names.add(name)
    return names


def verify_pdf(entry: dict, variant: str, assets: Path, output: Path) -> dict:
    workbook = entry["workbook"]
    artifact = entry["pdfs"][variant]
    label = f"{workbook['topicId']}/{workbook['level']}/{workbook['count']}/{variant}"
    check(
        re.fullmatch(r"/artifacts/[a-f0-9]{64}\.pdf", artifact["path"]) is not None,
        f"{label}: invalid content-addressed artifact path",
    )
    check(
        artifact["path"] == f"/artifacts/{artifact['sha256']}.pdf",
        f"{label}: artifact path does not match hash",
    )
    path = assets / artifact["path"].lstrip("/")
    check(not path.is_symlink(), f"{label}: artifact must not be a symbolic link")
    data = path.read_bytes()
    check(data.startswith(b"%PDF-"), f"{label}: artifact is not a PDF")
    check(len(data) == artifact["bytes"], f"{label}: artifact size does not match")
    check(
        hashlib.sha256(data).hexdigest() == artifact["sha256"],
        f"{label}: artifact SHA-256 does not match",
    )
    page_count = (workbook["count"] + 3) // 4
    fonts = set()
    with pymupdf.open(stream=data, filetype="pdf") as document:
        check(not document.is_encrypted, f"{label}: PDF unexpectedly encrypted")
        check(len(document) == page_count, f"{label}: wrong page count")
        check(document.embfile_count() == 0, f"{label}: unexpected PDF attachment")
        metadata = "\n".join(str(value) for value in document.metadata.values())
        all_text = []
        for page_number, page in enumerate(document):
            page_label = f"{label}/page-{page_number + 1}"
            check(
                abs(page.rect.width - 595.276) < 1.5
                and abs(page.rect.height - 841.89) < 1.5,
                f"{page_label}: page is not portrait A4",
            )
            check(not page.get_links(), f"{page_label}: unexpected PDF link")
            check(not list(page.annots() or []), f"{page_label}: unexpected annotation")
            fonts.update(verify_fonts(document, page))
            raw_text = page.get_text("text", sort=False)
            check("\ufffd" not in raw_text, f"{page_label}: missing text glyph")
            text = normalized(raw_text)
            all_text.append(text)
            check(normalized(workbook["title"]) in text, f"{page_label}: missing title")
            check(
                "SET" + workbook["instanceHash"][:12] in text,
                f"{page_label}: missing exact workbook identity",
            )
            check(
                f"{page_number + 1}/{page_count}" in text,
                f"{page_label}: missing page numbering",
            )
            page_items = workbook["items"][page_number * 4 : (page_number + 1) * 4]
            check(bool(page_items), f"{page_label}: unexpected blank page")
            if variant == "student":
                if page_number == 0:
                    lesson = workbook["lesson"]
                    assert_order(
                        text,
                        [lesson["title"], lesson["rule"], lesson["example"]],
                        page_label + "/lesson",
                    )
                    assert_order(
                        text,
                        [
                            fragment
                            for step in lesson["steps"]
                            for fragment in (
                                RELATION_LABELS[step["relation"]],
                                step["math"],
                                step["reason"],
                            )
                        ],
                        page_label + "/worked-example",
                    )
                exercise_marker = normalized("練習しよう")
                check(
                    exercise_marker in text, f"{page_label}: missing exercise heading"
                )
                assert_order(
                    text.split(exercise_marker, 1)[1],
                    [
                        fragment
                        for item in page_items
                        for fragment in (item["instruction"], item["prompt"], "答え")
                    ],
                    page_label,
                )
            else:
                page_answers = entry["answers"][page_number * 4 : (page_number + 1) * 4]
                fragments = []
                for item, answer in zip(page_items, page_answers, strict=True):
                    check(item["id"] == answer["id"], f"{page_label}: answer mismatch")
                    fragments.extend(
                        (item["instruction"], item["prompt"], "答え" + answer["answer"])
                    )
                    fragments.extend(
                        fragment
                        for step in answer["steps"]
                        for fragment in (
                            RELATION_LABELS[step["relation"]],
                            step["math"],
                            step["reason"],
                        )
                    )
                assert_order(text, fragments, page_label)

            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        x0, y0, x1, y1 = span["bbox"]
                        check(
                            x0 >= -1
                            and y0 >= -1
                            and x1 <= page.rect.width + 1
                            and y1 <= page.rect.height + 1,
                            f"{page_label}: text outside page bounds: {span['text']}",
                        )
            if workbook["level"] == "standard" and workbook["count"] == 8:
                destination = output / (
                    f"{workbook['topicId']}-{variant}-{page_number + 1}.png"
                )
                page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(
                    destination
                )
        if variant == "student":
            assert_no_answer_trace(
                "".join(all_text) + normalized(metadata), workbook, entry["answers"]
            )
    return {
        "selection": label,
        "pages": page_count,
        "bytes": len(data),
        "fonts": sorted(fonts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, default=Path("apps/studio/.release"))
    parser.add_argument("--output", type=Path, default=Path("output/studio-release"))
    args = parser.parse_args()
    catalog = json.loads((args.release / "catalog.json").read_text())
    check(catalog["schemaVersion"] == "studio-release-v1", "Unknown release schema")
    workbooks = catalog["workbooks"]
    selections = {
        (
            entry["workbook"]["topicId"],
            entry["workbook"]["level"],
            entry["workbook"]["count"],
        )
        for entry in workbooks
    }
    check(
        len(workbooks) == 18
        and selections == set(itertools.product(TOPICS, LEVELS, COUNTS)),
        "Release must contain exactly the 18 supported workbook selections",
    )
    args.output.mkdir(parents=True, exist_ok=True)
    results = [
        verify_pdf(entry, variant, args.release / "public", args.output)
        for entry in workbooks
        for variant in VARIANTS
    ]
    report = {
        "releaseId": catalog["releaseId"],
        "pdfs": len(results),
        "pages": sum(result["pages"] for result in results),
        "representativeImages": 12,
        "checks": results,
    }
    (args.output / "verification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps({key: value for key, value in report.items() if key != "checks"}))


if __name__ == "__main__":
    main()
