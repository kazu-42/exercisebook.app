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
