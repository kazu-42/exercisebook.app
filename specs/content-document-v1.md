# Spec: ContentDocumentV1

## Summary

Define the portable, versioned curriculum representation produced from the
author-facing Markdown/YAML format.

## Inputs

- UTF-8 CommonMark source.
- YAML frontmatter with `schema`, identity, revision, locale, skills,
  prerequisites, authors, license, draft publication status, and estimated
  minutes.
- Allowlisted `worked-example`, `exercise`, `hint`, `interactive`,
  `reflection`, `figure`, and `callout` directives.

## Output

`ContentDocumentV1` JSON with:

- `schema: "exercisebook.content-ast/v1"`;
- stable content identity and integer revision;
- locale and title;
- skill and prerequisite references;
- typed content nodes;
- license and attribution record;
- source hash and compiler version.

The checked-in JSON Schema is the portable **structural interoperability
projection**. It describes the constraints that can be represented faithfully
in JSON Schema and records additional semantic requirements in
`x-exercisebook-runtime-invariants`. The exported versioned validation
entrypoint is normative for runtime acceptance: it runs the bounded plain-data
guard on the original input before the Zod contract, including semantic and
cross-field checks that the generated JSON Schema cannot express. Calling the
bare Zod schema is not the complete trust boundary. TypeScript types are
inferred from that runtime contract.

## Behavior

1. Parse with resource limits for source bytes, YAML depth/aliases, AST nodes,
   and directive attributes. Before Markdown parsing, require canonical
   Phase-1 directive headers: exact `:::` container or `::` leaf fences,
   an ASCII allowlisted name, and same-line whitespace-separated
   `key="value"` attributes. Reject shorthand, valueless attributes, labels,
   alternative quoting, and longer fences.
2. Reject unknown fields and directives.
3. Normalize author-controlled data without executing it.
4. Require the comma-separated author display used by Worksheet attribution to
   fit its 240-character field; Phase 1 never truncates legal attribution.
5. Require unique taught-skill and prerequisite IDs; a content document teaches
   at most 20 skills, matching the worksheet slot boundary.
6. Resolve each generator revision through a registry that declares supported
   locales, per-directive item capacity, and the maximum directives a
   materializer can combine. Phase 1 permits at most one
   `fractions.add@1` directive and supports it only for `en`.
7. Preserve semantic text and math nodes rather than renderer-specific markup.
8. Hash the exact normalized source bytes and record the compiler version.
9. Emit canonical JSON using the project canonicalization contract.
10. In Phase 1, accept only `publication.status: "draft"`. A source author
   cannot make content publishable by writing `published` in frontmatter.

### Phase-1 inline math grammar

Inline math is parsed by a strict, complete parser rather than filtered with a
TeX-command denylist. The only terminals are:

- ASCII digits;
- `+`, `-`, `=`, `(`, `)`, `.`, and `,`;
- whitespace;
- `\frac`, followed by exactly two braced groups whose contents recursively
  use this same grammar.

All input must be consumed. Other backslash commands, raw control characters,
encoded control-sequence forms, `%` comments, unbalanced braces, bare braces,
and every other character are rejected. This is a small authoring grammar; it
is not TeX and is never passed through as executable TeX source. The normative
ContentDocument validator runs this same bounded parser and requires each math
node's `accessibleText` to equal the parser's deterministic derivation from
`source`.

## Edge cases

- Duplicate IDs, missing license data, invalid locale, and unknown skill IDs
  are validation errors and block any future publication.
- YAML implicit dates and lossy numeric coercion are disabled.
- Raw HTML, JSX/MDX, executable fences, filesystem paths, data URLs, and
  unreviewed remote assets are rejected.
- Math syntax is data; it cannot load packages, read files, or execute TeX.
- `publication.status: "published"` in source frontmatter is rejected in
  Phase 1, even if every other field is valid.
- Runtime validation, rather than the structural JSON Schema alone, enforces
  unique node IDs, taught-skill/prerequisite separation, and HTTP(S) source
  URLs without credentials.

## Dependencies

- Versioned directive registry.
- Skill and generator registries.
- License/provenance validation.
- A future trusted release-approval and immutable release-manifest mechanism
  before any content can become published. That mechanism is outside the
  Phase-1 compiler/materializer.

## Acceptance criteria

- [ ] JSON Schema accepts the structural projection of runtime-valid fixtures.
- [ ] Runtime Zod tests enforce the semantic and cross-field invariants listed
      in `x-exercisebook-runtime-invariants`.
- [ ] Invalid/hostile corpus fixtures fail with bounded typed diagnostics.
- [ ] Self-attested `published` frontmatter and encoded TeX controls/comments
      are rejected.
- [ ] Compiler output contains no React, Hono, Cloudflare, Typst, or TeX types.
- [ ] Canonical output is byte stable across repeated runs.
