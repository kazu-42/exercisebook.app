# Exercise Book content authoring

Status: proposed contract
Checked: 2026-07-19

## Purpose

Exercise Book needs to support explanations, worked examples, generated
practice, answer keys, interactive Web activities, and printable worksheets
without asking authors to write application code.

Authors edit a deliberately small language:

- CommonMark Markdown;
- YAML frontmatter with a versioned schema;
- an allowlist of typed educational directives;
- a restricted TeX-style math surface;
- immutable asset IDs rather than filesystem paths or arbitrary URLs.

Markdown is the authoring surface, not a publication approval. The compiler
creates a versioned draft `Content AST`; daily planning creates a fully
concrete, immutable `Worksheet Instance AST`. Web and print projections render
that same instance. A future trusted release manifest will be the publication
authority; source frontmatter can never self-attest that review happened.

The implemented Phase-1 boundary is local compilation, deterministic
materialization, Web rendering, `PrintDocumentV1`, and printable A4 HTML. No
hosted application, Browser Run PDF service, or LuaLaTeX backend is claimed by
this document.

The print/runtime design is described in
[printing and Cloudflare architecture](research/printing-cloudflare.md).

## Author example

```markdown
---
schema: exercisebook.content-source/v1
id: math.fractions.add-unlike-denominators
revision: 1
title: Add fractions with unlike denominators
locale: en
skills:
  - math.fractions.add-unlike
prerequisites:
  - math.fractions.equivalent
authors:
  - name: Exercise Book contributors
    role: author
license:
  licenseId: LicenseRef-ExerciseBook-Draft
  sourceUrl: https://exercisebook.app/content/math/fractions/add-unlike-denominators
  attributionText: Draft original lesson by Exercise Book contributors. Not yet licensed for publication.
  copyrightHolder: Exercise Book contributors
publication:
  status: draft
estimatedMinutes: 15
---

# Add fractions with unlike denominators

To add fractions, first describe both quantities using equal-sized parts.

:::worked-example{id="worked-example-01" title="One third plus one fourth"}
Rewrite $\frac{1}{3}$ as $\frac{4}{12}$ and $\frac{1}{4}$ as
$\frac{3}{12}$. Then add: $\frac{4}{12} + \frac{3}{12} = \frac{7}{12}$.
:::

:::exercise{id="practice-01" generator="fractions.add" version="1" count="8" difficulty="2" instruction="Add each pair of fractions. Give every answer in lowest terms."}
:::

:::interactive{id="fraction-bars-01" kind="fraction-bars" prompt="Build both fractions with equal-sized pieces." printFallback="Draw two equal bars, divide both into the common number of pieces, and shade each addend."}
Use the fraction bars to find an equivalent form for each addend.
:::

:::reflection{id="reflection-01"}
Why must the parts be the same size before the numerators can be added?
:::
```

This file cannot call `Math.random()`, calculate a canonical answer, import a
React component, execute JavaScript, fetch a remote URL, read a local file, or
embed a raw TeX document. The compiler resolves and validates all referenced
skills, generators, assets, and fallbacks.

## Syntax contract

### Frontmatter

Required fields:

| Field | Meaning |
|---|---|
| `schema` | exact compiler/schema contract |
| `id` | stable, locale-independent content identity |
| `revision` | monotonically increasing source revision |
| `title` | localized human-readable title |
| `locale` | BCP 47 locale |
| `skills` | skills taught or assessed |
| `prerequisites` | author assertion, validated against the reviewed graph |
| `authors` | stable contributor records |
| `license` | SPDX-like expression plus attribution/provenance data |
| `publication.status` | `draft` only in Phase 1; not a release approval |

Optional fields must be declared by the schema. Unknown fields fail closed.
YAML parsing has limits for bytes, nesting depth, aliases, and collection size.
Implicit date/coercion behavior is disabled where it would change meaning
between runtimes.

### Markdown

Supported:

- headings, paragraphs, emphasis, lists, tables, links, block quotes, and code
  examples;
- inline and display math in the approved subset;
- footnotes if the Web and print renderers preserve equivalent semantics;
- reviewed internal asset references.

Rejected in general curriculum:

- raw HTML;
- MDX and JSX;
- `<script>`, event handlers, iframes, and embeds;
- executable code fences;
- protocol-relative or unreviewed external assets;
- data URLs and local filesystem paths;
- raw TeX preambles, package loading, and document commands.

External links can be allowed by a link policy, but the render pipeline never
fetches them while producing a worksheet.

#### Phase-1 inline math

Phase 1 parses a deliberately tiny math grammar. It is not a TeX sanitizer and
does not accept general TeX.

Allowed terminals are ASCII digits, whitespace, `+`, `-`, `=`, `(`, `)`, `.`,
and `,`. Fractions use `\frac` followed by exactly two braced groups; each
group is parsed recursively with the same grammar, so nested fractions are
possible. The parser must consume the entire source.

Everything else fails closed: unknown backslash commands, hexadecimal,
Unicode, or other encoded control-sequence forms, `%` comments, ASCII control
characters, bare or unbalanced braces, scripts, identifiers, and package or
document commands. Renderers receive a validated math data node, never
executable author-supplied TeX.

### Directives

Every directive is registered with:

```ts
type DirectiveDefinition = {
  name: string;
  version: string;
  attributes: JsonSchema;
  body: JsonSchema;
  capabilities: Array<
    "explanation" | "assessment" | "interactive" | "print" | "media"
  >;
  toContentAst(input: ValidatedDirective): ContentNode;
};
```

Initial allowlist:

| Directive | Purpose | Required safety contract |
|---|---|---|
| `worked-example` | model and explain a solution | semantic model and reviewed step renderer |
| `exercise` | fixed or generated assessment item | generator/scorer version and solution |
| `hint` | progressive support | explicit order and evidence effect |
| `interactive` | Web manipulation or simulation | keyboard, alt/transcript, print fallback |
| `reflection` | open response or self-explanation | rubric or explicitly unscored |
| `figure` | reviewed image/diagram | asset ID, alt, caption, provenance |
| `callout` | note, warning, definition | semantic role, not color alone |

Phase-1 directive headers use one canonical syntax before Markdown parsing:
an exact `:::` opening fence for container directives (all entries above
except `figure`), or an exact `::` opening fence for the leaf `figure`
directive, followed immediately by the ASCII allowlisted directive name.
Attributes stay on that line and are whitespace-separated ASCII
`key="value"` pairs. Attribute shorthand (`#id` or `.class`), valueless
attributes, single-quoted/unquoted values, optional directive labels, and
backslash quote escaping are not accepted.

Unknown directives, attributes, generator versions, or fallback kinds are
compile errors. Directive implementations are trusted product code reviewed in
the repository; directive bodies are untrusted data.

## Canonical representations

### Content AST

`Content AST` is the versioned, reviewable representation of curriculum
meaning. It contains templates and generator references, not learner-specific
random values.

```ts
type ContentDocumentV1 = {
  schema: "exercisebook.content-ast/v1";
  id: string;
  revision: number;
  locale: string;
  title: string;
  skills: string[];
  prerequisites: string[];
  authors: Array<{
    name: string;
    role: "author" | "reviewer";
  }>;
  license: {
    licenseId: string;
    sourceUrl: string;
    attributionText: string;
    copyrightHolder: string;
  };
  publication: {
    status: "draft" | "published";
  };
  estimatedMinutes: number;
  nodes: ContentBlockV1[];
  sourceHash: string;
  compilerVersion: "exercisebook-content-compiler/1";
};

type ExerciseNodeV1 = {
  type: "exercise";
  id: string;
  generator: {
    id: string;
    version: string;
    parameters: Record<string, string | number | boolean>;
  };
  count: number;
  instruction: string;
};
```

The checked-in JSON Schema is shared by CI, the future browser editor, APIs,
persistence adapters, and renderer tests as a structural interoperability
projection. The exported runtime validation entrypoint is normative for
acceptance: it first checks the original bounded plain-data graph and then
applies the versioned Zod schema. A bare Zod parse is not the complete trust
boundary. Cross-field and semantic constraints that JSON Schema generation
cannot express are listed in `x-exercisebook-runtime-invariants` and enforced
by the runtime validator. Phase-1 examples include unique content/slot IDs,
taught-skill/prerequisite list uniqueness and separation, per-slot semantic ID
uniqueness, real calendar dates, IANA time zones, canonical reduced rationals
with positive denominators, HTTP(S) source URLs without credentials, the
128-decimal-digit integer bound, duration totals, and
answer/scoring/final-solution equality.

### Worksheet Instance AST

Planning and generation resolve every variable before a worksheet is shown:

```ts
type WorksheetInstanceV1 = {
  schema: "exercisebook.worksheet-instance/v1";
  assignmentId: string;
  title: string;
  localStudyDate: string;
  timeZone: string;
  locale: string;
  expectedMinutes: number;
  plan: {
    id: string;
    version: number;
  };
  policy: {
    id: string;
    version: number;
  };
  skillGraph: {
    id: string;
    revision: number;
  };
  rng: {
    algorithm: "xoshiro128ss-v1";
    seedSecretVersion: string;
    baseSeed: string;
  };
  content: Array<{
    id: string;
    revision: number;
    sourceHash: string;
    contentHash: string;
    compilerVersion: "exercisebook-content-compiler/1";
  }>;
  slots: ConcreteWorksheetSlot[];
  attributions: AttributionEntry[];
};

type WorksheetInstanceRecord = {
  assignmentId: string;
  instanceHash: string;
  objectKey: string;
  createdAt: string;
};

type ConcreteWorksheetSlot = {
  id: string;
  skillIds: string[];
  slotSeed: string;
  selectionReasons: string[];
  expectedMinutes: number;
  prompt: FractionAdditionPromptV1;
  canonicalAnswer: AnswerSpec;
  scoringRule: ScoringRule;
  hints: HintNode[];
  solutionTrace: SolutionStep[];
  misconceptions: MisconceptionRoute[];
  accessibility: AccessibilityProjection;
  printFallback: PrintFallbackV1;
  provenance: {
    contentId: string;
    contentRevision: number;
    sourceHash: string;
    contentHash: string;
    compilerVersion: "exercisebook-content-compiler/1";
    generatorId: string;
    generatorVersion: string;
    generationAttempt: number; // inclusive range 0..127 in Phase 1
  };
};
```

`WorksheetInstanceV1` is the canonical immutable payload stored in R2.
`WorksheetInstanceRecord` is assignment/storage metadata kept in D1 and is not
part of the hashed payload. `instanceHash` is the SHA-256 of the exact canonical
UTF-8 JSON bytes stored at `objectKey`; it is never embedded into the bytes it
hashes. The duplicated `assignmentId` is validated at the D1/R2 boundary.
Retries and render variants reuse the same payload without changing it.

Each concrete exercise slot contains:

- stable slot ID and per-slot seed;
- concrete prompt;
- typed canonical answer;
- scoring rule and version;
- complete solution trace;
- ordered hints and their evidence effects;
- misconception routes;
- Web and print representations;
- provenance and license references.

`timeZone` is an IANA time-zone ID. `baseSeed` is secret-derived replay data,
not the HMAC key itself; the canonical instance stays in the private artifact
boundary and the student delivery projection omits both base and slot seeds.
`seedSecretVersion` is required caller input. The materializer never infers or
defaults it.

Every slot provenance record must exactly match one top-level content reference
across content ID, revision, normalized source hash, compiled content hash, and
compiler version. The compiled hash binds the historical worksheet to the
exact Content Document bytes even if a later compiler interprets the same
source differently.

The learner is never presented a template that has not yet been instantiated
and persisted. Updating a generator later cannot change a historical instance.

### Print IR

`Print IR` is a renderer-neutral layout representation derived from a concrete
worksheet:

```ts
type PrintDocumentV1 = {
  schema: "exercisebook.print/v1";
  sourceInstanceHash: string;
  projectionVersion: string;
  paper: "a4" | "b5";
  locale: string;
  variant: "student" | "answer-key" | "teacher";
  blocks: PrintBlock[];
  attribution: AttributionEntry[];
};
```

It can express headings, text, exact math, tables, figures, callouts, problem
groups, working space, keep-together hints, page breaks, headers/footers, and
answer-key annotations. It cannot express arbitrary HTML, Typst, or TeX code.
The selected concrete variant is part of these canonical bytes and therefore
of `printDocumentHash`; the shared Worksheet Instance carries only
`variantPolicy`. The projector sets `sourceInstanceHash` and its own
`projectionVersion`; the render boundary rejects a Print Document whose source
hash does not equal the `instanceHash` in its Render Spec.

## Generator contract

```ts
interface ProblemGenerator<P, Model> {
  readonly id: string;
  readonly version: string;
  readonly parameters: JsonSchema<P>;

  generate(input: {
    params: P;
    rng: DeterministicRng;
    locale: string;
    difficulty: number;
  }): GeneratedProblem<Model>;

  validate(problem: GeneratedProblem<Model>): ValidationResult;
}

type GeneratedProblem<Model> = {
  model: Model;
  prompt: ContentNode[];
  canonicalAnswer: AnswerSpec;
  solutionTrace: SolutionStep[];
  hints: HintNode[];
  misconceptions: MisconceptionRule[];
  distractors?: Distractor[];
};
```

Prompt, answer, hints, solution, and distractors are projections of one exact
semantic model. For fractions, use exact rational values rather than binary
floating-point display strings.

Generation rules:

- explicit caller-supplied `seedSecretVersion`;
- per-slot seed derivation exactly as
  `lowercaseHex(HMAC-SHA256(hexDecode(baseSeed), UTF8(RFC8785(tuple))))`,
  where `baseSeed` decodes to a 32-byte binary HMAC key and `tuple` is
  `["exercisebook/slot-seed/v1", generatorId, generatorVersion,
  stableSlotDerivationId]`;
- no delimiter-concatenated seed messages;
- versioned RNG algorithm;
- constructive generation where possible;
- bounded rejection sampling;
- generator-defined semantic duplicate detection; fraction addition compares
  a sorted pair of canonical operands so operand order cannot evade
  deduplication;
- bounded deterministic duplicate retries that preserve the presentation slot
  ID and record `generationAttempt` provenance;
- deterministic fallback or typed failure;
- no current time, ambient locale, random global state, or network input;
- fixed test vectors for every generator version;
- property tests over large seed ranges.

## Answer types and scoring

Do not start with string equality. Initial answer types:

- `ExactInteger`
- `ExactRational`
- `NumericTolerance`
- `Choice`
- `OrderedSequence`
- `Set`
- `ExpressionEquivalence`
- `UnitQuantity`
- `TextRubric`
- `MultiPart`

Displayed TeX is never the canonical value. Mathematical input is parsed into a
semantic representation, normalized, and scored under a versioned policy.
Expression equivalence and CAS work must be separately resource-limited and is
introduced only for domains that need it.

Scoring records distinguish:

- first attempt from retry;
- unassisted from hinted;
- exact correct from partial/rubric evidence;
- Web-scored from paper self-report;
- practice from an unassisted mastery probe.

## Compiler and publication pipeline

```mermaid
flowchart LR
    S[Markdown source]
    P[Parse]
    N[Normalize]
    V[Schema + semantic validation]
    L[License/accessibility validation]
    C[Content AST]
    R[Human review]
    U[Immutable published revision]

    S --> P --> N --> V --> L --> C --> R --> U
```

Stages:

1. Parse with byte, depth, alias, and node-count limits.
2. Reject raw HTML/MDX and unknown syntax.
3. Normalize IDs, locale, numbers, whitespace, and math.
4. Validate the structural JSON Schema projection and the normative runtime
   Zod contract, including semantic and cross-field invariants.
5. Resolve skills, prerequisites, generator/scorer versions, and asset IDs.
6. Validate answer/solution, interactive fallbacks, accessibility, and license
   metadata.
7. Produce canonical JSON and a source/content hash.
8. Run automated fixtures and renderer previews.
9. Keep Phase-1 output in `draft` status.
10. In a future release pipeline, require correctness, pedagogy,
    accessibility, and license approval according to the content risk.
11. Have that trusted pipeline publish an immutable revision and signed or
    otherwise trusted release manifest.

Compilation has no network access. Link and asset import happen in a separate
controlled process before compilation. `publication.status: published` in
frontmatter is rejected by the Phase-1 compiler, and the Phase-1 materializer
also refuses a self-constructed published `ContentDocument`.

## Security model

### Parser and compiler

- bound source bytes, line length, nesting, YAML aliases, table size, and AST
  node count;
- fail closed on unknown fields and directives;
- sanitize error messages before returning them to an untrusted author;
- do not interpolate source strings into logs as structured-field names;
- prevent zip/decompression bombs in imported packages;
- compile in a time- and memory-bounded process.

### HTML and Web

- render HTML from typed nodes; do not concatenate author strings into markup;
- sanitize any legacy/imported HTML before it enters the AST;
- apply a strict Content Security Policy;
- self-host executable code and approved fonts/assets;
- prevent answers from leaking through DOM attributes, alt text, hydration
  state, source maps, API prefetches, or analytics;
- prohibit third-party tracking in learner content.

### Assets

- use immutable asset IDs resolved to reviewed metadata;
- verify declared and detected media type, byte size, dimensions, and hash;
- sanitize SVG or render it to a safe static form;
- reject script, external references, animation where inappropriate, and
  excessive path/node counts;
- never let a renderer fetch an arbitrary URL or filesystem path.

### Print backends

- authors cannot submit raw Typst/TeX;
- renderer templates escape all text/math/asset boundaries;
- Browser Run receives only trusted HTML and approved origins;
- Containers run without credentials or unrestricted network access;
- each compile has resource, output, and page limits;
- diagnostics are allowlisted and cannot contain learner PII.

## Reproducibility

Canonical JSON serialization and hashes are part of the contract. The
serializer follows one versioned UTF-8 profile with deterministic property and
number encoding; the initial profile should use
[RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/info/rfc8785):

```text
contentBytes  = UTF8(canonicalJson(ContentDocumentV1))
contentHash   = SHA-256(contentBytes)

instanceBytes = UTF8(canonicalJson(WorksheetInstanceV1))
instanceHash  = SHA-256(instanceBytes)
```

Schema, source/compiler, plan, generator, scorer, RNG, seed, and attribution
versions are fields inside those payloads. D1-only metadata such as `createdAt`
and the R2 object key is deliberately outside `instanceBytes`. `assignmentId`
is intentionally present in both the payload and D1 record and must match at
the storage boundary. R2 stores `instanceBytes` at
`instances/v1/sha256/<instanceHash>.json`, so the key always identifies the
actual stored bytes rather than a selected subset of fields.

The system records:

- original source hash and compiler version;
- Content AST schema and revision;
- planner/mastery policy versions and reason codes;
- generator/scorer IDs and versions;
- RNG algorithm, secret version, and stable slot seeds;
- asset and font hashes;
- Print IR, renderer, template, and runtime versions;
- output hash and validation results.

The HMAC secret key is never stored in an instance; only its version and the
derived base seed are recorded in the private canonical payload. Rotation
creates a new `seedSecretVersion`; it does not invalidate already materialized
instances.

## Author feedback

Compiler errors should be specific and stable:

```text
EB-CONTENT-014
docs/math/fractions/add.md:31:1
interactive "fraction-bars" requires printFallback
```

Each diagnostic includes:

- stable code;
- file, line, and column;
- offending field/directive;
- expected contract;
- concise remediation;
- documentation link.

The Phase-1 sample command writes Web and printable-HTML artifacts. A future
review UI should show:

- semantic Web view;
- A4 student printable HTML, and PDF only after a backend exists;
- answer key;
- accessibility tree/outline;
- license and attribution;
- resolved skills and prerequisites;
- generated fixed-seed samples;
- warnings that block publication separately from editorial suggestions.

## Tests and publication gates

### Compiler contract

- golden source-to-AST fixtures;
- canonical JSON and hash stability;
- schema migration fixtures;
- unknown syntax, raw HTML, executable content, and oversized input failures;
- missing skill, generator, scorer, asset, license, or attribution failures;
- prerequisite-cycle and invalid relation checks;
- interactive fallback and accessibility checks.

### Generator/scorer

- fixed seed test vectors;
- thousands of valid seed/property cases;
- bounded runtime and rejection count;
- exact binary-key HMAC/RFC 8785 slot-seed vectors, including delimiter-like
  and non-ASCII tuple values;
- answer/solution equivalence;
- distractor not equal to answer;
- commutative duplicate suppression, bounded deterministic retry, and
  `generationAttempt` provenance checks;
- difficulty monotonicity where the generator claims it;
- serialization/replay across supported runtimes.

### Renderer parity

Phase-1 gates:

- Web and print originate from the same instance hash;
- prompt, order, answer semantics, and attribution match;
- student variant has no answer fields and passes layered leak-marker checks;
- English fraction math, page breaks, and working-space HTML fixtures.

Future locale/content/PDF-backend gates:

- Japanese, tables, figures, and broader page-break snapshots;
- text extraction, font/glyph, page count, and PDF structure checks.

Leak-marker scanning is defense in depth, not a proof that arbitrary prose
cannot obfuscate an answer. The primary boundary is an allowlisted typed
student projection that makes answer, scoring, solution, seed, and diagnostic
fields unrepresentable; serialization and rendered-output scans then catch
regressions around that boundary.

### Human review

Publication requires named review states:

```text
draft
  -> machine_valid
  -> correctness_reviewed
  -> pedagogy_reviewed
  -> accessibility_reviewed
  -> license_reviewed
  -> published
```

Review requirements may vary by content type, but “AI generated” never bypasses
them. An LLM can draft or suggest a translation; it is not the authority for a
canonical answer, prerequisite, scoring rule, license, or publication status.
These states describe the future trusted release workflow. Phase 1 implements
only `draft`; no author-controlled frontmatter transition can enter
`published`.

## Versioning, migration, and rollback

Compatible editorial changes create a new content revision. Changes to node
meaning, generator/scorer behavior, or serialization require a version bump.

Rules:

- never edit a published revision in place;
- keep old schema readers as long as historical instances need replay;
- migrations are pure, versioned, fixture-tested transformations;
- preserve source and before/after hashes;
- do not automatically migrate an already assigned worksheet;
- invalidate caches by new content-addressed keys, not overwrite;
- keep renderer selection independent of content revision.

If a defect is found:

1. disable the content revision or generator version for new planning;
2. mark affected instances without deleting the historical record;
3. void invalid attempts so they do not update mastery;
4. publish a corrected revision/version;
5. regenerate only when the learner-facing product decision requires it;
6. add the defect as a regression fixture.

Independent kill switches cover a content revision, generator version, scorer
version, directive implementation, locale, and print backend.

## Initial implementation slice

Build one narrow vertical slice before a general editor:

1. `exercisebook.content-source/v1` frontmatter and seven directives;
2. normative Content AST and Worksheet Instance Zod contracts plus structural
   JSON Schema interoperability projections;
3. exact integer and rational answer types;
4. one reviewed fraction generator with fixed seed vectors;
5. one explanation, one worked example, one interactive with print fallback;
6. semantic Web renderer;
7. student and answer-key Print IR;
8. printable A4 HTML for local browser printing, without a PDF backend;
9. compiler, property, parity, accessibility, and HTML tests;
10. draft-only content flow plus a specified boundary for a future trusted
    release manifest.

This slice tests the architecture’s hardest invariant—one verified semantic
instance across instruction, assessment, Web, and print—without first building
a large curriculum or a general-purpose programming language.
