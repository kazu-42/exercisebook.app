# Exercise Book

> A new exercise book, every day.

Exercise Book is a free public learning platform for generating a small,
personalized set of explanations, worked examples, exercises, and review tasks
for each learner.

The long-term scope is deliberately broad: every age, grade, and subject. The
first implementation will be deliberately narrow so that correctness,
accessibility, print quality, provenance, and actual learning can be measured
before the content catalog expands.

## Project status

The first local walking skeleton is implemented. It compiles one draft English
fraction lesson with author/reviewer metadata, materializes eight deterministic
exact-rational problems, and projects the same immutable worksheet instance to:

- a Hono/React learning experience;
- separate student and answer-key Web views;
- renderer-neutral `PrintDocumentV1` data;
- self-contained, print-ready A4 HTML for both variants.

The project is not deployed, connected to either purchased domain, or ready for
learner data. Hosted PDF rendering, persistence, accounts, daily planning, and
curriculum breadth remain later roadmap phases.

The executable slice already verifies deterministic seeds and hashes, exact
answers and solution traces, student answer isolation, hostile content
rejection, keyboard access, Web/print semantic parity, and production builds.

## Local development

Requirements:

- Node.js 24 or newer;
- pnpm 11.8.0, as pinned by `packageManager`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The local Cloudflare/Vite runtime serves the application at the URL printed by
Vite. Useful routes include:

- `/`
- `/new`
- `/lessons/fractions/add-unlike-denominators`
- `/worksheet/sample`
- `/worksheet/sample/answers`
- `/worksheet/sample/print?variant=student`

Generate deterministic local worksheet, Web, and print artifacts with:

```bash
pnpm worksheet:sample
```

Generated artifacts are ignored by Git. The canonical worksheet JSON is
written byte-for-byte: its SHA-256 is the worksheet instance hash.

## Product model

Exercise Book does not treat an LLM response as the source of truth for an
exercise. A reviewed generator produces a semantic problem model, and the
prompt, canonical answer, hints, scoring rules, and worked solution are derived
from that same model.

```text
learner goal + evidence + time budget
                  |
                  v
        explainable daily planner
                  |
                  v
Markdown/YAML -> Content AST -> Worksheet Instance AST
                                      |
                         +------------+------------+
                         |                         |
                         v                         v
                 semantic Web UI            printable PDF
```

The exact instance shown to a learner is persisted before presentation. A
published exercise must remain reproducible from its content revision,
generator version, RNG version, seed, renderer version, template, and fonts.

## Non-negotiable properties

- Public learning material remains usable without an account.
- Web and PDF render the same concrete worksheet instance.
- Problems, answers, hints, and explanations cannot be randomized separately.
- `Math.random()`, wall-clock time, and live LLM output cannot determine a
  published answer.
- Mastery requires delayed, unassisted evidence across more than one exercise
  family; a short streak of near-identical answers is not mastery.
- Every interactive activity has a keyboard-accessible and printable fallback.
- Every imported asset carries source, revision, hash, author, attribution, and
  license metadata.
- Private learner data and personalized PDFs never enter public object paths or
  shared caches.
- A thin content bank fails closed to reviewed material; it does not silently
  fall back to live AI-generated questions.

## Proposed platform

- **Language/toolchain:** TypeScript 7, pnpm, Vite
- **Application:** Cloudflare Workers with Static Assets
- **HTTP adapter:** Hono
- **Web UI:** React with semantic HTML and progressive enhancement
- **Relational state:** D1
- **Immutable content and PDF artifacts:** R2
- **Asynchronous rendering:** Queues
- **MVP PDF backend:** Browser Run
- **Experimental PDF backend:** Typst WASM
- **High-fidelity backend:** LuaLaTeX in a Cloudflare Container
- **Authoring:** CommonMark Markdown, YAML frontmatter, and allow-listed
  directives
- **Canonical formats:** versioned Content AST and Worksheet Instance AST

The domain model does not depend on Cloudflare, React, Typst, or TeX. PDF
engines are replaceable adapters behind one artifact contract.

## Documentation

- [System architecture](docs/architecture.md)
- [Content authoring and generation contract](docs/content-authoring.md)
- [Adaptive learning and daily planning](docs/research/adaptive-learning.md)
- [OER, standards, and licensing](docs/research/oer-and-standards.md)
- [Printing, LuaLaTeX, and Cloudflare](docs/research/printing-cloudflare.md)
- [Naming and domains](docs/naming-and-domains.md)
- [Delivery roadmap](docs/roadmap.md)
- [Architecture decision record](docs/decisions/0001-core-architecture.md)
- [TypeScript 7 toolchain decision](docs/decisions/0002-typescript-7-toolchain.md)
- [Engineering guardrails](AGENTS.md)

## Domains

- [`exercisebook.app`](https://exercisebook.app) is the primary site and
  canonical public origin.
- [`learning.new`](https://learning.new) is an action domain. It must enter the
  creation flow for a new exercise book directly; it must not become a
  marketing homepage.

Both domains were registered on 2026-07-19 JST and confirmed through Google
Registry RDAP. Operational details and the `.new` policy boundary are recorded
in [docs/naming-and-domains.md](docs/naming-and-domains.md).

## Licensing

No project-wide license has been granted yet.

The current proposal is Apache-2.0 for software authored by this project and
CC BY 4.0 for original learning material and project documentation, with
third-party material separated according to its own license. These choices
require an explicit owner decision before `LICENSE` files are added. Until
then, ordinary copyright applies and external contributions are not yet open.
