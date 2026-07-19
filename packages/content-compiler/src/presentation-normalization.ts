/**
 * Joins parser-owned plain-text fragments before applying the sole authoring
 * normalization for selected presentation prose. Runtime consumers validate
 * and copy this value; they must not normalize it again.
 */
export function normalizePresentationPlainTextParts(
  textParts: readonly string[],
): string {
  return textParts
    .join("")
    .replaceAll(/[\p{White_Space}\uFEFF]+/gu, " ")
    .trim();
}

const GFM_TABLE_DELIMITER_CELL = /^[ \t]*:?-{3,}:?[ \t]*$/u;

/**
 * The Phase-1 parser intentionally does not enable GFM. Detect its table
 * delimiter explicitly so table-shaped Markdown cannot be flattened into a
 * presentation paragraph and mistaken for reviewed plain prose.
 */
export function containsGfmTableDelimiterRow(textParts: readonly string[]): boolean {
  return textParts
    .join("")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed.includes("|")) {
        return false;
      }

      const withoutLeadingPipe = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
      const withoutEdgePipes = withoutLeadingPipe.endsWith("|")
        ? withoutLeadingPipe.slice(0, -1)
        : withoutLeadingPipe;
      const cells = withoutEdgePipes.split("|");
      return (
        cells.length > 0 && cells.every((cell) => GFM_TABLE_DELIMITER_CELL.test(cell))
      );
    });
}
