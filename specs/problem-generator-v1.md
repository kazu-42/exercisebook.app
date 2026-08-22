# Spec: ProblemGeneratorV1

## Summary

Generate exact, replayable fraction problems from reviewed code and a
deterministic random source.

## Inputs

- Generator ID and immutable version.
- Validated generator parameters.
- A 32-byte base seed represented externally as exactly 64 lowercase
  hexadecimal characters.
- Stable presentation slot ID and, for retries, a stable slot derivation ID.
- Locale and bounded difficulty value.

## Outputs

- Exact semantic problem model.
- Semantic prompt nodes.
- Canonical typed answer.
- Scoring rule.
- Progressive hints.
- Ordered solution steps.
- Misconception rules.
- Accessibility summary.

## Exact rational representation

Persist rationals as:

```ts
type RationalJson = {
  numerator: string;
  denominator: string;
};
```

Both strings are canonical base-10 integers. The denominator is positive and
the fraction is reduced by the greatest common divisor. Each integer has at
most 128 decimal digits; the signed serialized form therefore has
`maxLength: 129` and matches
`^(?:0|-?[1-9][0-9]{0,127})$`. Internal arithmetic may use `bigint`; floating
point is forbidden for canonical math.

## Determinism

- RNG identity: `xoshiro128ss-v1`.
- Seed input: exactly 64 lowercase hexadecimal characters.
- The `xoshiro128ss-v1` seed expander is part of the versioned identity:

  1. Split the 64-character seed from left to right into eight 8-hex-digit
     unsigned 32-bit words. Each chunk uses its textual most-significant digit
     first.
  2. Initialize lanes `s0..s3` to unsigned
     `[0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344]`.
  3. For word index `i = 0..7`, choose lane `i & 3` and compute
     `x = u32(lane + word[i] + imul32(i + 1, 0x9e3779b9))`.
  4. Replace that lane with
     `x = imul32(x ^ (x >>> 16), 0x21f0aaad)`,
     then `x = imul32(x ^ (x >>> 15), 0x735a2d97)`,
     then `x = u32(x ^ (x >>> 15))`. Every intermediate multiplication and
     addition wraps modulo `2^32`; `>>>` is an unsigned logical shift.
  5. If all four lanes are zero, replace `s0` with `0x6d2b79f5`.

  Reference initial states are:

  ```text
  seed = 00...00:
    [3998325653, 1233102409, 1166978463, 2566542581]
  seed = ff...ff:
    [2990597607, 222769137, 832746839, 2946293579]
  seed = 00000001 00000002 ... 00000008:
    [1493323359, 1596209297, 967882612, 2322470581]
  ```

  This custom expansion is not implied by the public xoshiro algorithm name;
  another runtime must implement these exact steps before applying the frozen
  xoshiro128** transition/output function.
- Slot derivation is exactly:

  ```text
  slotSeed =
    lowercaseHex(
      HMAC-SHA256(
        key = hexDecode(baseSeed), // exactly 32 binary bytes
        data = UTF8(
          RFC8785([
            "exercisebook/slot-seed/v1",
            generatorId,
            generatorVersion,
            stableSlotDerivationId
          ])
        )
      )
    )
  ```

- The tuple is an array with the field order shown above. Delimiter-based
  string concatenation is forbidden.
- Fixed vectors freeze RNG and generator behavior.
- Any behavior change requires a new generator or RNG version.

`seedSecretVersion` is explicit materializer input supplied by the caller and
is recorded in the worksheet instance. It is not inferred from the base seed,
ambient configuration, or a default. The Phase-1 public sample supplies a
replay seed directly; a future hosted planner may derive that base seed from a
versioned secret without changing the slot-derivation contract.

## Behavior

1. Construct valid operands directly when practical.
2. If rejection sampling is necessary, use a fixed maximum attempt count.
3. Derive prompt, answer, hints, solution, and distractors from one exact model.
4. Verify the final solution value equals the canonical answer.
5. Deduplicate worksheet prompts using a generator-defined semantic signature.
   For commutative fraction addition, normalize the two reduced operands and
   sort them before comparison, so `a + b` and `b + a` are the same prompt.
6. On a duplicate, retry deterministically with a stable derivation ID. Phase 1
   uses the presentation slot ID for attempt `0` and
   `<slotId>:retry-<generationAttempt>` for attempts `1` through `127`.
   Preserve the presentation slot ID, and record the accepted
   `generationAttempt` in slot provenance.
7. Return a typed terminal error after the bounded attempts rather than loop,
   silently accept a duplicate, or relax constraints.
8. `fractions.add@1` has 112 distinct difficulty-1 prompt signatures, but
   Phase 1 caps a worksheet at 96 items. The margin keeps the fixed 128-attempt
   per-slot retry reliable instead of advertising full-pool exhaustion as a
   usable authoring limit.

## Edge cases

- Zero denominator, noncanonical integer strings, overflow assumptions, `NaN`,
  `Infinity`, and locale-dependent number parsing are rejected.
- A distractor cannot equal the canonical answer.
- Same seed and version always produce the same canonical JSON.
- Deduplication is deterministic and commutative; exhausting attempt `127` is a
  typed generation failure.

## Acceptance criteria

- [ ] Fixed vectors include seed zero-like and all-`f` boundary values.
- [ ] Frozen HMAC vectors cover the exact RFC 8785 tuple, delimiter-like
      characters, and non-ASCII input.
- [ ] At least 10,000 generated cases satisfy rational invariants.
- [ ] A retry fixture proves commutative duplicate suppression and records
      `generationAttempt` in the inclusive range `0..127`.
- [ ] Difficulty and constraint parameters remain within declared bounds.
- [ ] No call to `Math.random()`, wall clock, environment locale, or ambient
      configuration can affect output.
