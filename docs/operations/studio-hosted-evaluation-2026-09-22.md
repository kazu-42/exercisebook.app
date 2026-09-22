# Japanese studio hosted evaluation, 2026-09-22

The owner explicitly requested deployment of the current studio on 2026-09-22,
then asked to continue. This authorizes hosting the existing evaluation build
and supersedes ADR-0004's pending hosting decision. It does not claim an
educator has reviewed the curriculum or expand the English material's CC BY
grant. The Japanese original draft remains reserved-rights evaluation material;
public access to this owner-hosted trial does not grant third-party adaptation
or redistribution rights. Existing notices accurately describe its limitations.

The first target is `exercisebook-studio-preview` on Cloudflare Workers. Record
its URL, exact release identity, deployment version, and remote verification
below after deployment. The existing primary origin and action redirect remain
available while this build is verified.

Initial release:
`studio-rc-64992f16e599460012f09af8aa15690a0e0175769dcb8aa1866525c3bf12bab4`.

The source-inventory and artifact-hash gate passed immediately before upload.
Rollback restores a complete recorded Worker version, never a mixed catalog
and artifact directory. The original package is archived under
`output/studio-releases/` with the release ID above.
