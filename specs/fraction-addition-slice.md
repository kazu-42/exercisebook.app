# Spec: Fraction addition walking skeleton

## Summary

Compile one reviewed lesson about adding fractions with unlike denominators,
instantiate deterministic exercises, and render the exact same worksheet as an
accessible Web page and printable student/answer-key documents.

## Inputs

- `content/en/math/fractions/add-unlike-denominators.md`: reviewed draft lesson
  source.
- `assignmentId`: opaque stable assignment identifier.
- `localStudyDate`: `YYYY-MM-DD`.
- `locale`: BCP 47 tag; the first fixture is `en`.
- `seed`: the replay/base seed, exactly 64 lowercase hexadecimal characters.
- `seedSecretVersion`: explicit stable caller input; the Phase-1 sample does
  not infer or default it.
- `variant`: `student` or `answer-key`.

## Outputs

- Valid `ContentDocumentV1` canonical JSON.
- Valid `WorksheetInstanceV1` canonical JSON.
- Semantic Web rendering with one worked example and generated exercises.
- `PrintDocumentV1` for student and answer-key variants.
- Printable A4 HTML. A person may use the browser's print dialog, but Phase 1
  does not implement a PDF service, Browser Run backend, or LuaLaTeX backend.

## Behavior

1. Parse only CommonMark, YAML frontmatter, and allowlisted directives.
2. Resolve the reviewed `fractions.add` generator.
3. Derive each slot seed with HMAC-SHA256 using the decoded 32-byte base seed
   as the key and the RFC 8785 canonical tuple
   `["exercisebook/slot-seed/v1", generatorId, generatorVersion,
   stableSlotDerivationId]` as the message. Never concatenate delimiters.
4. Deduplicate commutative prompts with bounded deterministic retries while
   preserving the presentation slot ID and recording `generationAttempt`.
5. Generate exact rational operands, canonical answer, hints, and solution
   steps from one problem model.
6. Persist all learner-visible values in the worksheet instance before render.
7. Render Web and print projections without regenerating a problem.
8. Exclude canonical answers and locked solutions from the student projection.
9. Replace the interactive fraction-bar activity with an explicit print
   fallback.
10. Compile and materialize draft content only. A future trusted release
    approval/manifest, not frontmatter, is required for publication.

## Edge cases

- A zero or negative denominator is rejected.
- Generated operands never require denominator zero and never use floating
  point arithmetic.
- Rejection sampling has a fixed bound and deterministic failure.
- Unknown frontmatter, directive, generator, or attribute fails closed.
- Raw HTML, MDX/JSX, raw TeX documents, and remote asset fetches are rejected.
- Inline math accepts only digits, Phase-1 basic operators/whitespace, and
  recursively nested `\frac` groups; other commands, encoded controls, and
  comments are rejected.
- Student HTML, metadata, accessible labels, and print output contain no answer.

## Dependencies

- [Content document contract](content-document-v1.md)
- [Problem generator contract](problem-generator-v1.md)
- [Worksheet instance contract](worksheet-instance-v1.md)
- [Print document contract](print-document-v1.md)

## Acceptance criteria

- [ ] TypeScript 7 is the build-authoritative compiler.
- [ ] The same source and seed produce byte-equivalent canonical instance JSON.
- [ ] Fixed vectors cover at least two seeds and do not change without a
      generator-version bump.
- [ ] Fixed vectors freeze binary-key HMAC/RFC 8785 slot derivation, including
      delimiter-like and non-ASCII tuple values.
- [ ] Property tests cover at least 10,000 generated fraction additions.
- [ ] A deterministic retry fixture proves commutative prompt deduplication and
      `generationAttempt` provenance.
- [ ] Every generated canonical answer equals the final solution step.
- [ ] Web and print preserve problem IDs, order, prompts, and attribution.
- [ ] Student projections contain no answer or solution data.
- [ ] The fraction-bar interaction is keyboard operable and has a print
      fallback.
- [ ] A local command writes sample HTML and canonical JSON artifacts.
- [ ] The sample remains explicitly draft and does not claim a trusted release,
      hosted deployment, or PDF backend.
- [ ] Formatting, TypeScript, unit/property tests, and production build pass.
