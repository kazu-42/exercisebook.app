# Spec: PrintDocumentV1

## Summary

Project a validated `WorksheetInstanceV1` into renderer-neutral layout data
without regenerating or reinterpreting learning content.

Phase 1 renders this contract to printable A4 HTML only. A browser print dialog
can produce a local PDF, but a hosted PDF service, Browser Run adapter, and
LuaLaTeX adapter are outside this implemented slice.

## Inputs

- Verified source worksheet instance and its hash.
- Projector version.
- Paper size: `a4` initially.
- Concrete variant: `student` or `answer-key` initially.

## Output

`PrintDocumentV1` with:

- `schema: "exercisebook.print/v1"`;
- `sourceInstanceHash`;
- projector version;
- paper, locale, and variant;
- semantic print blocks;
- attribution records.

Supported blocks include headings, paragraphs, math, worked examples, problem
groups, fraction-bar figures, working space, keep-together hints, page breaks,
headers/footers, and answer-key annotations.

## Behavior

1. Project only from concrete instance fields.
2. Keep the student variant free of canonical answers, scoring internals, and
   locked solution text.
3. Use the interactive node's reviewed print fallback.
4. Produce deterministic canonical JSON for the same source and projector
   version.
5. Render printable HTML with explicit page, font, color, and spacing rules.

## Edge cases

- Reject a source hash that does not match the instance bytes.
- Reject an unavailable variant or missing print fallback.
- Long text, math, and figures must not silently disappear at page boundaries.
- Print CSS cannot fetch arbitrary origins.

## Acceptance criteria

- [ ] Student and answer-key documents share source instance hash and problem
      order.
- [ ] Student print output passes answer-leak tests.
- [ ] A4 sample HTML can be rendered by a local browser.
- [ ] Extracted text contains all expected prompts and attribution.
- [ ] Visual fixtures cover long text, fraction math, working space, and page
      breaks.
