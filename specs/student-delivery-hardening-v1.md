# Spec: Student Delivery Hardening v1

Status: implemented in draft PR #3
Branch: `feat/student-delivery-hardening`
Base: `feat/daily-plan-preview`

## 1. Summary

Close two student-facing trust-boundary gaps before a hosted catalog or PDF
service is allowed:

1. a hash-valid worksheet must not disclose one problem's canonical answer in
   another problem's non-prompt student fields or printable fallback; and
2. browser worksheet loaders must not buffer an unbounded response or accept
   duplicate-key JSON with last-key-wins semantics.

This slice tightens already-promised confidentiality and transport invariants.
Currently generated worksheets and fixed safe fixtures retain identical
canonical and output bytes; the student-presentable subset is narrowed by a
fail-closed authorization check, so previously accepted noncanonical
accessibility prose can now fail. The slice does not add persistence, accounts,
hosted PDF, DNS, deployment, or learner evidence.

## 2. Evidence and threat model

Canonical hashing proves the identity of the bytes; it does not authorize
student-visible fields. On base commit `e0c4d92`, a rehashed
`WorksheetInstanceV1` passed the shared student projector when slot A's
`printFallback.text` contained slot B's canonical answer. The student
PrintDocument path then projected that fallback from the full answer-bearing
instance.

On that same base, browser loaders used `Response.json()`. That API can buffer a
response before an application-owned byte limit is enforced and uses
JavaScript's last-key-wins behavior for duplicate object keys. A duplicate
response key could therefore make transport interpretation differ from a
strict producer or review. The fixed sample loader also lacked a caller abort,
timeout, and media-type check.

In scope attackers and failures are:

- reviewed or generated source with a semantic cross-slot disclosure while
  retaining valid canonical bytes and hash;
- a compromised, buggy, cached, or intercepted first-party endpoint returning
  malformed, duplicate-key, invalid-UTF-8, misleading-length, oversized, or
  indefinitely streaming JSON;
- a component unmount, route change, caller cancellation, or timeout while a
  response body read is pending;
- a later refactor accidentally reading answer-bearing source fields from the
  student PrintDocument path.

This is defense in depth, not a claim that arbitrary natural-language
obfuscation can be recognized as an answer.

## 3. Shared student-field authorization

The normative student delivery projector validates the source instance and
then applies role-sensitive answer recognition:

- global student-visible fields are checked against every canonical answer;
- `prompt.left` and `prompt.right` are the only structured fields with a
  cross-slot operand exception;
- `prompt.accessibleText` must equal the deterministic English fraction-
  addition representation derived from `left` and `right`, with no appended or
  substituted prose;
- `accessibility.summary`, as the alternate prompt representation, must equal
  its separate deterministic representation derived from the same operands;
- `prompt.instruction` and every other slot field are checked against every
  canonical answer, including hints, selection reasons, provenance, and print
  fallback;
- the current slot's own answer is always forbidden in every student-visible
  field and as either structured prompt operand;
- a different slot's canonical rational may therefore appear only in the exact
  derived accessible representations when it is structurally equal to the
  current prompt's left or right operand;
- canonical rational equality applies to structured values. String scanning is
  defense in depth over a documented finite set of exact canonical encodings;
  it does not claim to recognize unreduced equivalents, decimals, or arbitrary
  natural-language paraphrases;
- if equal canonical answers occur in more than one slot, membership as the
  current slot's answer wins and the value remains forbidden.

This exception is deliberately narrow. It preserves legitimate mathematics
such as an operand in one problem equaling another problem's answer, without
authorizing the same value in prose, hints, captions, or fallbacks.

The Web projector keeps its final DTO and worked-example scans because it
introduces student-visible structure after the shared projection. An allowed
operand followed by appended text such as `The answer is ...` fails the exact
derived-text check rather than inheriting the operand exception.

The exported `projectWorksheetForStudentWithCanonicalAnswers` function is a
trusted server-projector context, not a public response contract. It returns an
answer-free delivery plus detached canonical answers solely so Web and print
projectors can authorize their final student DTOs. Callers must never serialize,
cache, log, return it from an HTTP handler, persist it in browser state, or
import it into React/client code. The ordinary public student path remains
`projectWorksheetForStudent`, which returns only `StudentWorksheetDeliveryV1`.

Before its first asynchronous hash operation, the trusted function rejects
accessors and other unsafe object graphs, captures every materialization
envelope field, and validates the instance into a detached snapshot. Hash
verification, answer authorization, and downstream projection therefore refer
to the same snapshot even if a caller retains and mutates its original object.
Consumer projectors must not re-read that caller-owned materialization after
awaiting verification.

## 4. PrintDocument boundary

For the student variant, `projectPrintDocumentV1` must project layout blocks
from `StudentWorksheetDeliveryV1`, the answer-free value returned by the shared
projector. Student helper functions accept delivery-derived minimal types and
cannot read canonical answers, scoring rules, misconceptions, seeds, or locked
solutions.

The detached verified full instance remains available only inside the trusted
server projection for:

- the answer-key projection; and
- the existing protected-source defense-in-depth comparison.

A final post-validation student-only PrintDocument assertion retains field-role
information:

- each problem's fraction prompt and prompt accessibility text must equal the
  deterministic projection of its source operands;
- a fraction-bar fallback's bar values, bar labels, and accessible label must
  equal that same deterministic operand projection;
- the current problem's answer is forbidden in every field;
- instructions, response labels, captions, free-form fallbacks, headings,
  paragraphs, worked examples, attributions, provenance, and every other field
  are checked against every answer.

A blanket scan of the entire document is still prohibited because it would
reject legitimate structured operands. The role-sensitive final assertion
prevents a future type-correct projector change from moving an authorized
operand into a caption or prose field. Accepted safe source instances retain
byte-identical canonical worksheet and PrintDocument outputs, so no schema,
generator, policy, or projector version changes in this slice.

## 5. Bounded strict browser JSON

Both worksheet loaders use one application-local shared response decoder.
Route owners supply explicit limits:

- daily-plan preview response: `32 * 1024` delivered bytes;
- fixed sample worksheet response: `64 * 1024` delivered bytes.

The shared decoder also permits at most 1,024 non-final read operations. Empty
chunks count. This bounds stream-loop work and chunk bookkeeping even when an
attacker makes no progress toward the byte limit.

The decoder applies this order:

1. when the supplied signal is already aborted, best-effort cancel the body and
   reject with the exact same reason;
2. require media-type essence `application/json`, allowing parameters, and
   cancel on failure;
3. interpret `Content-Length`, when present, only as a strict nonnegative
   decimal early upper-bound hint;
4. reject malformed or over-limit declared lengths and cancel the body;
5. incrementally read `response.body` with a stream reader and count delivered
   `Uint8Array.byteLength` values and non-final read operations;
6. reject and cancel a non-`Uint8Array` chunk, a 1,025th non-final read, or a
   measured byte count above the route limit;
7. race each pending read with abort and preserve the exact caller or timeout
   reason identity;
8. decode completed bounded bytes with fatal UTF-8;
9. parse with the existing duplicate-aware JSON parser; and
10. remove abort listeners and release the reader lock on every path.

Cancellation or lock-release failure is secondary and never replaces the
primary invalid-response, caller-abort, or timeout reason.

The measured stream is authoritative. A smaller declared length never bypasses
the measured limit, while a harmless declared/measured mismatch below the cap
is accepted because Fetch can expose decoded bytes with encoded headers.

The decoder never calls `Response.json()`, `Response.text()`,
`Response.arrayBuffer()`, or `Response.clone()`. It rejects a missing body,
invalid UTF-8, malformed JSON, literal duplicate keys, escaped-equivalent
duplicate keys, nesting beyond 64 levels, and more than 512 parsed values
before the route DTO validator runs. Moving the strict parser from Worker-only
to shared code must leave the request-body behavior and limits unchanged.

The decoder limits define a stricter transport envelope than the reusable DTO
schemas. Producer-compatibility tests serialize every currently producible
8-, 12-, and 20-minute preview and both fixed sample variants, assert they fit
their route cap with deliberate headroom, parse them through the same 64-depth
and 512-value strict parser, and report the maximum observed bytes. Future byte
or structural growth fails CI before it reaches a learner browser.

## 6. Cancellation and error contract

The daily preview retains its existing 15-second composed request deadline.
The fixed sample loader gains the same bounded deadline and accepts a caller
`AbortSignal`. `WorksheetPage` creates a controller per load and aborts it on
cleanup, so a variant change or unmount stops the network and body read rather
than merely suppressing a stale state update.

Caller abort and deadline timeout are control-flow identities, not malformed
responses. Loaders rethrow the exact preserved reason. Non-abort transport,
decode, and DTO-validation failures remain sanitized recoverable UI errors and
must not echo request or response data.

Expected cleanup cancellation displays no network error, performs no
post-cleanup state update, and cannot let an older student/answer-key response
overwrite a newer variant.

## 7. Failure matrix

| Condition | Required result |
| --- | --- |
| Cross-slot answer in a global or non-prompt field | Fail before student delivery |
| Cross-slot answer equal to a structured left/right operand | Accept only in that prompt representation |
| Authorized operand repeated in appended prompt answer prose | Fail exact derived-text check |
| Current answer equal to an operand, including duplicate-equal answers | Fail closed |
| Student print helper attempts answer-bearing access | Type-level boundary prevents it |
| Print projector moves an allowed operand into caption/prose | Final role-sensitive assertion fails |
| Wrong or missing JSON media type | Cancel/reject as sanitized invalid response |
| Malformed/ambiguous/over-limit `Content-Length` | Cancel/reject before unsafe reading |
| Missing length or under-declared body | Measure stream; enforce route cap |
| Exact cap | Accept if UTF-8, JSON, and DTO are valid |
| Measured cap plus one byte | Cancel/reject |
| 1,025th empty or nonempty body read | Cancel/reject |
| Non-byte stream chunk or locked/disturbed body | Cancel/reject as sanitized invalid response |
| Invalid UTF-8 or duplicate/malformed JSON | Reject before DTO validation |
| Caller abort before or during read | Cancel; reject with identical reason object |
| 15-second deadline during read | Cancel; reject with dedicated timeout identity |
| Component unmount or variant change | Abort superseded load; no error or stale overwrite |
| Caller mutates a materialization after projection begins | Continue from the detached pre-await snapshot only |

## 8. Observability and privacy

This slice adds no analytics, cookies, storage, durable data, or third-party
requests. Expected learner-caused invalid responses remain sanitized and are
not logged with bodies. Future production telemetry may count coarse decoder
failure codes and response-size buckets, but it must not record worksheet
payloads or learner inputs.

## 9. Verification

- Rehashed cross-slot leak regressions fail in both shared student delivery and
  student PrintDocument projection.
- Legitimate cross-slot operand reuse passes only through exact derived prompt
  representations; appended answer prose and every non-prompt location fail.
- A final PrintDocument role regression proves that an allowed operand cannot
  be moved into a caption, fallback, paragraph, or other non-prompt field.
- Duplicate-equal answers cannot weaken the own-answer rule.
- The content-resolved Phase 1 hash remains
  `5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b`;
  both student and answer-key PrintDocument semantic goldens and printable
  sample verification remain unchanged.
- The 12-minute planner vector remains plan
  `preview-0ceccc181b16205f75577fb8fcae010433680890fab0bafa759e8cb5e6cd4d45`
  with base seed
  `fe05015e60ae92979bbd77f1101c5789fa78fcfc0ad524268ef7eaff59102815`,
  while the 8/12/20 budget-map and stable-prefix tests remain green.
- The arbitrary sample vector remains assignment
  `sample-0d2e4f18c887611e9b4e6739ef1cb3697df8f2ef1bc2b2cbceb6c5f8773470ef`
  and instance
  `69d9c7ebe12ab40093f3d084015b02a0f658f57566176793501a6fd208a65888`.
- Decoder tests cover media types, declared and measured byte limits,
  multibyte UTF-8, bad UTF-8, duplicate keys, JSON limits, missing bodies,
  zero-byte and many-small-chunk read limits, non-byte chunks, disturbed bodies,
  pending reads, early-failure cancellation, cancellation-failure precedence,
  exact abort identity, listener/lock cleanup, and DTO failures.
- Producer-budget tests cover all preview budgets and both sample variants.
- Component tests prove sample unmount/variant cancellation, no expected-abort
  error state, no stale overwrite, and recoverable real UI failure.
- TypeScript 7, formatting, all tests, schemas/content, dependency boundaries,
  production build, dependency audit, sample artifacts, and production-bundle
  browser smoke pass.
- An independent correctness/security review and an independent UX/operations
  review approve the final diff or their findings are repaired and rechecked.

## 10. Rollback

Revert the stacked feature commit or draft PR. No stored instance, schema,
database, content revision, public API version, or deployed resource requires a
migration. Until this slice passes, hosted/public student PDF remains disabled;
the local `/new` flow may continue printing its already-sanitized Web DTO.
The trusted server-only projector context is an internal TypeScript API and
does not change serialized worksheet, Web, or PrintDocument versions.

## 11. Explicit deferrals

- content-derived lesson and worked-example projection;
- answer submission, feedback, hints, retry evidence, and mastery;
- endpoint rate limiting and the complete production header policy;
- automated cross-browser CI;
- hosted PDF and tagged-PDF accessibility;
- licenses, Cloudflare project/DNS, and deployment owner decisions.
