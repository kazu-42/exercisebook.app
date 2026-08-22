# Spec: WorksheetInstanceV1

## Summary

Define the immutable, fully materialized assignment payload presented to a
learner and shared by Web and print projections.

## Inputs

- Assignment identity, study date, time zone, and locale.
- Versioned plan, goal, skill graph, mastery, and selection-policy references.
- An explicit caller-supplied seed-secret version, base seed, RNG version,
  content revisions, and generator versions.
- Ordered concrete worksheet slots.
- Attribution records.

## Output

`WorksheetInstanceV1` canonical JSON containing no unresolved template variable
or renderer-specific markup.

Each concrete slot contains:

- stable slot ID and skill IDs;
- slot seed;
- selection reason codes and expected minutes;
- semantic prompt;
- typed canonical answer and scoring rule;
- hints and ordered solution;
- misconceptions and accessibility data;
- optional print fallback;
- content/generator provenance, including the accepted deterministic
  `generationAttempt` in the inclusive range `0..127`;
- the exact compiled `contentHash` and `compilerVersion`, in addition to the
  source hash, on both the top-level content reference and slot provenance.

## Behavior

1. Validate the complete payload before presentation.
2. Serialize with RFC 8785 canonical JSON.
3. Compute `instanceHash` as SHA-256 of exact canonical UTF-8 bytes.
4. Store the object by content address before committing its assignment pointer.
5. Return a student delivery projection that omits base/slot seeds, canonical
   answer, locked solution, scoring internals, and diagnostic leakage.
   Global and per-slot non-prompt delivery fields are checked against every
   canonical answer. Prompt accessibility strings must equal deterministic
   derivations from the structured left/right operands. A different slot's
   answer is therefore permitted only as a genuine operand representation; the
   current slot's answer is always forbidden, including when two slots have
   equal answers.
6. Never mutate a historical instance; corrections create a new revision.
7. Treat the exported versioned validation entrypoint as normative for
   acceptance. It applies the bounded plain-data guard to the original input
   before the Zod contract, because a bare Zod parse is not the complete trust
   boundary. The checked-in JSON Schema is a structural interoperability
   projection, not an alternative semantic validator.

The caller supplies `seedSecretVersion`; materialization never guesses it from
the seed or ambient configuration. Slot seeds follow the exact binary-key
HMAC/RFC 8785 tuple in
[ProblemGeneratorV1](problem-generator-v1.md). A retry changes only the stable
derivation ID and recorded `generationAttempt`; it does not change the
presentation slot ID.

## Edge cases

- Assignment ID in storage metadata and canonical payload must match.
- Hash fields use exactly 64 lowercase hexadecimal characters without prefixes.
- Unknown schema/RNG/generator/content revisions fail closed.
- Every slot provenance tuple `(contentId, contentRevision, sourceHash,
  contentHash, compilerVersion)` matches exactly one top-level content
  reference. `contentHash` identifies the exact canonical Content Document
  bytes, so recompiling unchanged source with another compiler cannot create
  ambiguous historical provenance.
- An invalidated content revision remains replayable but cannot create new
  assignments.
- Runtime validation, rather than the structural JSON Schema alone, enforces
  real calendar dates, IANA time-zone identifiers, canonical reduced rationals
  with positive denominators and at most 128 decimal digits per integer,
  HTTP(S) attribution URLs without credentials, unique IDs, duration totals,
  and answer/scoring/final-solution equality.
- The original input graph is limited to 50,000 graph nodes, depth 128, and
  1,000,000 aggregate UTF-16 code units across property names and string
  values. Prototype-sensitive own keys, accessors, symbols, cycles, sparse
  arrays, invalid Unicode, and non-plain prototypes fail before Zod parsing.
- Skill IDs and selection reasons are unique within each slot. Hint,
  solution-step, and misconception IDs are also unique within their respective
  slot collections.
- Phase-1 materialization accepts draft content only. A future trusted release
  manifest may authorize published content; source frontmatter never
  self-authorizes publication.
- Canonical JSON and its hash prove exact identity, not student-field
  authorization. A recomputed, hash-correct instance containing an answer in a
  global field, hint, accessibility field, or print fallback still fails the
  student projection.

## Acceptance criteria

- [ ] Same validated input yields byte-identical canonical JSON and hash.
- [ ] Student projection answer-leak tests cover text, attributes, accessible
      labels, URLs, metadata, and serialized application state.
- [ ] Cross-slot tests reject answers in every non-prompt field, allow only a
      genuine structured operand in another slot's exactly derived prompt,
      reject appended answer prose, and keep the own-answer rule fail-closed
      for duplicate-equal rationals.
- [ ] Leak-marker scanning is documented and tested as defense in depth; it is
      not treated as proof against arbitrary prose obfuscation.
- [ ] Web and PrintDocument projections name the same instance hash.
- [ ] Runtime validator tests cover every semantic invariant listed in the
      generated schema's `x-exercisebook-runtime-invariants`.
- [ ] Domain code has no Cloudflare or framework imports.
