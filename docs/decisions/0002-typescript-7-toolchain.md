# ADR-0002: TypeScript 7 toolchain baseline

- Status: Accepted
- Date: 2026-07-19
- Owner: Repository owner

## Context

Exercise Book needs one compiler contract across domain packages, content
tooling, Hono Workers, React interfaces, and test fixtures. The repository owner
explicitly selected TypeScript 7.

At the decision readback, the official `typescript` package publishes stable
`7.0.2` as `latest`. It exposes the `tsc` command backed by platform-specific
native TypeScript packages. The older `@typescript/native-preview` package
remains a development preview and is not the project dependency.

TypeScript 7 changes the tooling boundary: code that merely consumes JavaScript
output and declarations is low risk, while tools that embed the historical
JavaScript compiler API may lag or be incompatible.

## Decision

1. Pin `typescript` to exact version `7.0.2` for the first executable baseline.
2. Treat the workspace `tsc` command as the only build-authoritative typecheck.
3. Use TypeScript only for erasable syntax in application source. Enable
   `erasableSyntaxOnly`, `verbatimModuleSyntax`, strict checking,
   `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
4. Use Vite for application bundling and TypeScript 7 for type checking and
   declarations. Do not depend on TypeScript emit for the Web bundle.
5. Do not install `@typescript/native-preview` alongside stable TypeScript.
6. Avoid tools that require the legacy in-process TypeScript compiler API until
   they explicitly support TypeScript 7. Prefer protocol, JSON Schema, source
   files, or declaration-file boundaries.
7. CI prints and checks the workspace compiler version before type checking.
8. Upgrades within TypeScript 7 are deliberate lockfile changes with full
   format, type, test, build, generated-schema, and fixed-vector verification.
9. An editor may use a compatible language server, but editor diagnostics are
   advisory; CI using the pinned workspace compiler is authoritative.

## Consequences

### Positive

- Native compiler performance is available from the beginning.
- The project does not accumulate a TypeScript 5/6 migration backlog.
- Strict, erasable syntax keeps source portable across Vite, Workers, tests,
  and future non-Node tooling.
- Compiler upgrades are auditable through the lockfile and CI.

### Costs and risks

- Some lint, documentation, transform, or analysis tools may not yet support
  TypeScript 7 compiler APIs.
- Editor integration can temporarily differ from CI.
- A third-party package's declared TypeScript peer range may lag even when its
  runtime types are compatible.

Mitigation is to keep framework/tool dependencies outside the domain, avoid
compiler-API coupling, pin exact versions, and require a TS7 compatibility
probe before adoption.

## Verification

- `pnpm exec tsc --version` reports `Version 7.0.2`.
- `pnpm typecheck`, tests, and production builds use the workspace lockfile.
- CI rejects a compiler major other than 7.
- No source uses non-erasable TypeScript constructs.
- No package depends on `@typescript/native-preview`.

## Sources

- [TypeScript package 7.0.2](https://www.npmjs.com/package/typescript/v/7.0.2)
- [TypeScript native port](https://github.com/microsoft/typescript-go)
