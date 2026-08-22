/**
 * Browser transport caps are deliberately tighter than the DTO schemas. A
 * producer-size regression must fail before a larger response is published.
 */
export const MAX_DAILY_PLAN_PREVIEW_RESPONSE_BYTES = 32 * 1_024;
export const MAX_SAMPLE_WORKSHEET_RESPONSE_BYTES = 64 * 1_024;
