# Temporary extract-zip hardening

Verified on 2026-09-22. `@cloudflare/puppeteer@1.4.0` depends on
`@puppeteer/browsers@2.2.4`, which includes `extract-zip@2.0.1`. The Node browser
installer is not called by this application's Cloudflare Browser Run adapter;
the application connects to Cloudflare's managed browser through its binding.
We still patch the installed dependency rather than relying on that reachability
assumption to dismiss the advisories.

The official advisories [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)
describe unchecked archive symlink targets and overwriting through an existing
leaf symlink. Both list no patched version. The npm registry has no `2.0.2`
release, even though the audit recommendation may suggest that version.
[Upstream PR 160](https://github.com/max-mapper/extract-zip/pull/160) was still
open and only addresses the leaf check; it does not resolve both cases.

`patches/extract-zip@2.0.1.patch` implements a deliberately narrower extraction
contract:

- Reject every archive symlink entry, including links within the destination.
- Create regular files using exclusive creation (`wx` / `O_EXCL`). Existing
  final components, including dangling symlinks, fail atomically. Duplicate file
  entries and overwriting preexisting regular files also fail.
- Preserve ordinary files and directories and the existing parent containment
  checks. This is not a sandbox against another process concurrently replacing
  ancestor directories.

The patch is local hardening, not a claim that upstream `2.0.1` is fixed. It
deliberately does not preserve general Node browser-installer compatibility:
archives requiring symlinks or overwrite behavior will fail. If local browser
installation through this dependency becomes a requirement, review a supported
replacement rather than relaxing the patch. The package's original BSD-2-Clause
license remains in the installed package.

`node scripts/check-extract-zip-patch.mjs` resolves the actual dependency used by
the studio, pins its version and exact patched entry-point SHA-256, and executes
eight extraction regressions with real ZIP bytes in a disposable directory.
These cover ordinary nested files, absolute/relative/internal archive symlinks,
a symlink followed by a same-name file, preexisting and dangling leaf symlinks,
and duplicate regular files. Canary files outside each extraction directory
must retain their bytes. No production paths or external downloads are used.

The dependency audit must run this check successfully before narrowly excluding
the two named advisories. Do not use `--ignore-unfixable`, ignore registry errors,
or disable other audit findings. A checksum mismatch or any regression failure
blocks the audit exception. Retain raw `pnpm audit` as a diagnostic for the
upstream package status. `pnpm audit --help` in pinned pnpm 11.8.0 documents the
repeatable `--ignore <GHSA>` option; [pnpm's audit documentation](https://pnpm.io/cli/audit)
documents advisory exclusions.

When an upstream release fixes both flaws, upgrade and remove the patch, its
exact advisory exceptions, and this temporary integrity gate together. Run the
malicious ZIP regressions against the replacement before removing them. Do not
roll back to the unpatched dependency to recover a browser installer failure.
