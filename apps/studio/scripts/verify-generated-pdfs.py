# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf==1.26.7"]
# ///
"""Inspect and rasterize all six generated workbook selections and variants.

Run after: pnpm exec tsx apps/studio/scripts/verify-generated-pdfs.ts
Then: uv run --no-project apps/studio/scripts/verify-generated-pdfs.py
"""

import importlib.util
import json
from pathlib import Path

import pymupdf


def main() -> None:
    source = Path(__file__).with_name("verify-release.py")
    spec = importlib.util.spec_from_file_location("release_verifier", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("The reviewed PDF verifier is unavailable.")
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    root = Path("output/studio-generated-pdf")
    catalog = json.loads((root / "catalog.json").read_text())
    verifier.check(
        catalog["schemaVersion"] == "studio-generated-pdf-verification-v1",
        "Unknown generated verification schema",
    )
    workbooks = catalog["workbooks"]
    selections = {
        (entry["workbook"]["topicId"], entry["workbook"]["level"])
        for entry in workbooks
    }
    verifier.check(
        len(workbooks) == 6 and len(selections) == 6,
        "Expected six topic/level selections",
    )
    checks = []
    images = 0
    for entry in workbooks:
        workbook = entry["workbook"]
        for variant in ("student", "answers"):
            checks.append(verifier.verify_pdf(entry, variant, root / "public", root))
            pdf = root / "public" / entry["pdfs"][variant]["path"].lstrip("/")
            with pymupdf.open(pdf) as document:
                for page_number, page in enumerate(document):
                    target = (
                        root
                        / f"{workbook['topicId']}-{workbook['level']}-{variant}-{page_number + 1}.png"
                    )
                    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).save(
                        target
                    )
                    images += 1
    report = {
        "schemaVersion": "studio-generated-pdf-report-v1",
        "pdfs": len(checks),
        "pages": sum(check["pages"] for check in checks),
        "images": images,
        "generatorCases": catalog["generatorCases"],
        "sourceHashes": catalog["sourceHashes"],
        "checks": checks,
    }
    (root / "verification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                key: value
                for key, value in report.items()
                if key not in {"checks", "sourceHashes"}
            }
        )
    )


if __name__ == "__main__":
    main()
