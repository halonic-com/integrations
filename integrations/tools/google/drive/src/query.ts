/**
 * Builds Drive's query syntax (`q` in files.list). Every value the model
 * passes goes through {@link quoted}, so it can't end the string and add
 * clauses of its own.
 */

/** Leaves out the trash, as every listing does. */
export const notTrashed = "trashed = false";

/** A value as a Drive query string: in single quotes, with `\` and `'` escaped. */
export function quoted(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Files directly inside the folder. */
export function inFolder(folderId: string): string {
  return `${quoted(folderId)} in parents`;
}

/** Files whose name or contents hold the text. */
export function nameOrContentHas(text: string): string {
  return `(name contains ${quoted(text)} or fullText contains ${quoted(text)})`;
}

/** All clauses must hold. */
export function allOf(clauses: readonly string[]): string {
  return clauses.join(" and ");
}
