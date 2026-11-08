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

/**
 * Whether putting the query in brackets keeps it in one clause. That holds
 * when its brackets balance outside its quoted strings and every string is
 * closed: `name = 'a') or (trashed = true` would close our bracket and open
 * its own.
 *
 * A `"` outside a string is refused. We only know `'` strings; if Drive also
 * read `"..."` as one, `name = "'") or (trashed = true or name = "'"` would
 * balance for us and still break out for Drive.
 */
export function staysInOneClause(query: string): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < query.length; index++) {
    const character = query[index];
    if (inString) {
      // An escaped character, such as \' or \\, never ends the string.
      if (character === "\\") index++;
      else if (character === "'") inString = false;
    } else if (character === "'") {
      inString = true;
    } else if (character === '"') {
      return false;
    } else if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inString;
}

/** Whether a query searches file contents, which Drive can't sort. */
export function searchesContents(query: string): boolean {
  // A false positive, such as the word inside a string, only costs the order.
  return query.includes("fullText");
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
