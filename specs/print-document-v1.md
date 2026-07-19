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
3. Project the student variant from the verified answer-free
   `StudentWorksheetDeliveryV1`; the answer-bearing source instance is
   available only to the answer-key path and defense-in-depth source checks.
4. Use the interactive node's reviewed print fallback only after the shared
   field-sensitive student boundary accepts it.
5. After validation, apply a final field-role assertion: problem and
   fraction-bar operands must equal their delivery source and every other field
   is scanned against all answers. This prevents a projector refactor from
   moving an authorized operand into a caption or prose field.
6. Produce deterministic canonical JSON for the same source and projector
   version.
7. Render printable HTML with explicit page, font, color, and spacing rules.

## Edge cases

- Reject a source hash that does not match the instance bytes.
- Also reject a hash-correct source that places one slot's canonical answer in
  another slot's non-prompt student fields. Do not blanket-scan the completed
  document against all answers: a legitimate structured operand may equal a
  different slot's answer.
- Reject an unavailable variant or missing print fallback.
- Long text, math, and figures must not silently disappear at page boundaries.
- Print CSS cannot fetch arbitrary origins.

## Acceptance criteria

- [ ] Student and answer-key documents share source instance hash and problem
      order.
- [ ] Student print output passes answer-leak tests.
- [ ] Rehashed cross-slot fallback leaks fail, while legitimate cross-slot
      prompt operand reuse keeps the existing valid output bytes unchanged.
- [ ] A final-role regression rejects an authorized operand moved into a
      caption, paragraph, or other non-prompt PrintDocument field.
- [ ] A4 sample HTML can be rendered by a local browser.
- [ ] Extracted text contains all expected prompts and attribution.
- [ ] Visual fixtures cover long text, fraction math, working space, and page
      breaks.
