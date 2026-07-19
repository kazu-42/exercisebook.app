/**
 * The exported validation entrypoints (original-input guard followed by Zod)
 * are normative for these semantic constraints. The checked-in JSON Schemas
 * expose them as metadata because JSON Schema validators can only enforce the
 * structural projection.
 */
export const CONTENT_DOCUMENT_V1_RUNTIME_INVARIANTS = [
  "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
  "Every math node uses the bounded Phase-1 math language and its accessibleText equals the deterministic derivation from source.",
  "Content node IDs are unique.",
  "Taught skill IDs and prerequisite IDs are unique within their respective lists.",
  "A prerequisite is not duplicated in the taught skill list.",
  "Comma-separated author names fit the 240-character worksheet attribution author field.",
  "License source URLs use HTTP(S) and contain no credentials.",
  "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
] as const;

export const CONTENT_DOCUMENT_V2_RUNTIME_INVARIANTS = [
  "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
  "Every non-presentation math node uses the bounded Phase-1 math language and its accessibleText equals the deterministic derivation from source.",
  "Every explanation paragraphs array and worked-example steps array contains between one and eight non-empty strings, each using compiler-owned canonical whitespace normalization.",
  "Every fraction-addition worked-example uses reduced canonical rational operands and result, and its common denominator, scaled numerators, unreduced sum numerator, and reduced result equal independent exact-integer derivations from the operands.",
  "Content node IDs are unique.",
  "Taught skill IDs and prerequisite IDs are unique within their respective lists.",
  "A prerequisite is not duplicated in the taught skill list.",
  "Comma-separated author names fit the 240-character worksheet attribution author field.",
  "License source URLs use HTTP(S) and contain no credentials.",
  "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
] as const;

export const WORKSHEET_INSTANCE_V1_RUNTIME_INVARIANTS = [
  "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
  "Slot IDs are unique.",
  "Each slot has unique skill IDs, selection reasons, hint IDs, solution-step IDs, and misconception IDs.",
  "The scoring rule equals the canonical answer.",
  "The final solution result equals the canonical answer.",
  "Top-level expectedMinutes equals the sum of slot expectedMinutes.",
  "Top-level content references are unique by content ID and revision.",
  "Each slot provenance content ID, revision, source hash, compiled content hash, and compiler version matches exactly one top-level content reference.",
  "localStudyDate is a real Gregorian calendar date.",
  "timeZone is recognized as an IANA time-zone identifier by the runtime.",
  "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
  "Rational values are reduced and have positive denominators.",
  "Attribution source URLs use HTTP(S) and contain no credentials.",
  "Student delivery projection rejects recognized canonical-answer representations in visible strings.",
] as const;

export const WORKSHEET_INSTANCE_V2_RUNTIME_INVARIANTS = [
  "Original input is a plain data-object graph limited to 50,000 graph nodes, depth 128, and 1,000,000 aggregate property-name and string-value code units, with valid Unicode and without prototype-sensitive own keys, accessors, symbols, or cycles.",
  "The selected presentation uses the fixed revision-2 content ID, compiler, and lesson, worked-example, and exercise node IDs for presentation v1; its bounded source and compiled content hashes are authorized against policy by the resolver.",
  "The worked-example common denominator, scaled numerators, unreduced sum numerator, and reduced result equal independent exact-integer derivations from its operands.",
  "Top-level content references are unique by content ID and revision and use compiler v2.",
  "The selected presentation content matches exactly one top-level content reference.",
  "Slot IDs are unique.",
  "Each slot has unique skill IDs, selection reasons, hint IDs, solution-step IDs, and misconception IDs.",
  "Every slot provenance content ID, revision, source hash, compiled content hash, and compiler version matches both the selected presentation and exactly one top-level content reference.",
  "Every slot uses fractions.add@1 and its prompt instruction equals the selected exercise instruction.",
  "No slot canonical answer is rationally equal to the selected worked-example left operand, right operand, or result.",
  "The scoring rule equals the canonical answer.",
  "The final solution result equals the canonical answer.",
  "Top-level expectedMinutes equals the sum of slot expectedMinutes.",
  "localStudyDate is a real Gregorian calendar date.",
  "timeZone is recognized as an IANA time-zone identifier by the runtime.",
  "locale is a canonical BCP 47 tag accepted by Intl.Locale.",
  "Rational values are reduced, lexically canonical, bounded, and have positive denominators.",
  "Attribution source URLs use HTTP(S) and contain no credentials.",
] as const;
