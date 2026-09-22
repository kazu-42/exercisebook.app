# Local Browser Run installation diagnostic

Observed on 2026-09-22 on macOS arm64 with Node `v26.9.0`, Wrangler
`4.125.0`, and Miniflare `5.20260820.0-alpha`.

The local PDF POST reached the adapter's 30-second deadline while Miniflare
installed Chrome for Testing `126.0.6478.182`. This was a local browser
installation failure, not evidence of failure in the deployed Browser Run
service. The deployed adapter requires its own smoke test.

## Evidence

- Miniflare's distributed JavaScript bundles `@puppeteer/browsers@2.10.6` and
  specifies browser version `126.0.6478.182`. An override of a separate installed
  `extract-zip` dependency does not rewrite that bundled implementation.
- The downloaded archive was at
  `~/Library/Caches/.wrangler/chrome/126.0.6478.182-chrome-mac-arm64.zip`.
- Its SHA-256 was
  `1ff4772b6d97548fdafdc9beda8873a188ed67cbec6aa9c412bdd4bf8148f7c1`.
  This is the observed local artifact hash, not a separately authenticated
  publisher checksum.
- Python `zipfile.ZipFile.testzip()` verified every entry's CRC. The archive
  contained 310 entries; the incomplete destination contained only six entries,
  including two files. Repeated PDF requests did not complete installation.
- Extracting that same complete archive to a fresh temporary directory using
  `/usr/bin/unzip -q <archive> -d <temporary-directory>` completed within the
  45-second subprocess limit. The extracted binary's `--version` completed
  within 10 seconds and returned `Google Chrome for Testing 126.0.6478.182`.

These observations isolate the failure to the JavaScript installation/extraction
path in this local environment. They do not establish whether Node 26, macOS,
the bundled extraction library, or their interaction is the underlying cause.
No reproduction on Linux with Node 24 was performed during this diagnostic.

## One-time local recovery

The running Wrangler process was stopped before changing its browser cache.
The existing incomplete installation directory was renamed, preserving it at:

```text
~/Library/Caches/.wrangler/chrome/mac_arm-126.0.6478.182.incomplete-1790071729
```

The successfully extracted directory was moved into:

```text
~/Library/Caches/.wrangler/chrome/mac_arm-126.0.6478.182
```

The binary under
`chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
again reported the exact expected version after the move. No completed-install
marker was forged; Miniflare retains responsibility for marking a successful
browser launch. The backup and original archive were left in place.

This recovery did not modify application code, dependency manifests, lockfiles,
Miniflare's installed files, D1, or R2. Browser version output confirms the
installation is executable; only a subsequent PDF request confirms the complete
local Worker-to-browser path.

## CI policy

Keep the normal provider-supported installation path and test it on the selected
Node 24 Linux CI environment. Do not add a custom browser downloader or
platform-specific extraction workaround based only on this local observation.
If CI also encounters a cold-install deadline, separate browser installation
from the bounded PDF request using the provider's supported tooling and verify
the complete PDF request afterward. Do not increase the production renderer's
timeout to conceal an incomplete local installation.

## Linux CI failure and retained evidence

[CI run 35716183235](https://github.com/kazu-42/exercisebook.app/actions/runs/35716183235)
on commit `14cde9f` passed the eighteen-workbook/thirty-six-PDF build, all-level
generated PDF checks, and Worker deployment dry-run. The final local Worker
journey reached its first real PDF download and then exceeded Playwright's
45-second download wait. The previous failure caused by differing uv cache
directories was resolved by installing pinned Playwright with `UV_CACHE_DIR`
unset, matching the sanitized PDF subprocess environment.

That run did not retain Worker output after smoke-test failures, so its logs do
not establish whether Chrome installation, browser acquisition, rendering, or
another request-stage error caused the missing download. A successful Python
Playwright installation does not preinstall Miniflare's separate Chrome for
Testing cache.

The CI Worker now writes to `output/studio-worker/worker.log`. On a failed local
journey, the cleanup trap prints the log without replacing the original failing
exit status. The existing always-run artifact step also retains it in
`japanese-studio-release-candidate`, alongside the available screenshots and
PDFs. Inspect this log before diagnosing another download timeout or modifying
the renderer's deadline. Application runtime code is unchanged by this
diagnostic improvement.

## Independent CI browser preparation

CI now prepares Miniflare's browser in a separate, bounded setup step before the
application journey. It resolves Miniflare and esbuild from the pinned Wrangler
dependency, bundles a small in-memory Worker, and uses Miniflare's exported
`convertV4MiniflareOptions`, `Miniflare`, `dispatchFetch`, and `dispose` APIs.
The Worker calls the installed Cloudflare Puppeteer SDK's `launch`, `version`,
and `close` methods through its local Browser Run binding. This keeps SDK
WebSocket handling inside workerd. The setup has a four-minute process deadline
and five-minute CI step limit; it must succeed before the full UI journey runs.

This path uses the provider's normal browser installer and its current browser
revision. It does not modify cache directories, invent a completion marker,
hardcode a Chrome download URL, create a workbook, use D1/R2, or increase the
application's 30-second render deadline. The isolated runtime binds only to
loopback and is disposed afterward. Logs are retained at
`output/studio-worker/browser-preflight.log` even on failure. A failed setup
remains a failing CI result.

The same in-memory Worker path was verified locally on 2026-09-22, returning
`200 Chrome/126.0.6478.182` and closing successfully using the already prepared
macOS cache. That proves the Worker/SDK/API integration, not a clean Linux
download; the next CI execution supplies that evidence.

The pinned Miniflare implementation exports `launchBrowser` but keeps its
default browser revision internal. Its browser launch/install path and Wrangler
4.125.0 contain no executable-path override such as `CHROME_PATH` or
`PUPPETEER_EXECUTABLE_PATH`. Do not rely on those unrelated-tool variables here.
Cloudflare documents local Puppeteer support through
[Wrangler and the Browser Run binding](https://developers.cloudflare.com/browser-run/reference/wrangler/).
The lower-level APIs are documented in the
[Miniflare repository](https://github.com/cloudflare/workers-sdk/tree/main/packages/miniflare);
the pinned package's exported declarations are the compatibility authority for
this setup step.

## Cloud and Linux variable-font names

An isolated remote Worker confirmed that Cloud Browser reports the hash-pinned
font as `NotoSansJP_400wght` and `NotoSansJP_700wght` with `isCustomFont: true`.
macOS Chromium uses the `NotoSansJP-` face-name prefix. Rejecting the remote
names caused the application PDF check to fail despite valid font bytes.
The adapter now accepts the exact weight-instance shape from 100 through 900
as well as the legacy prefix, while retaining the byte hash, custom-font check,
network isolation, and thirty-second deadline. Twelve new cases cover both
valid weights and unapproved identities. An actual eight-question worksheet
completed through the corrected remote adapter in 7.424 seconds, including
browser launch and close, producing 633,743 PDF bytes.

CI run 35717475559 confirmed that the new independent browser preparation
succeeds on fresh Linux. Its pre-fix application returned a visible 503 in
1,303 ms, rather than timing out during installation. The next runtime release
must include the font-name compatibility fix and pass the full UI PDF smoke.
The ephemeral diagnostic Worker was stopped; no diagnostic endpoint was
deployed, and no production storage was changed by that diagnostic.
