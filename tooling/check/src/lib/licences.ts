/**
 * The licence check (plan 11): exact SPDX IDs, with `OR`, `AND`, `WITH` and
 * parentheses understood. Shipped code and dev tooling have separate lists.
 */

/** The contents of `tooling/check/licences.json`. */
export interface LicencePolicy {
  /** Allowed in code we ship: the app and the CLI bundle. */
  readonly shipped: readonly string[];
  /** Allowed on top of `shipped` for build and dev tooling only. */
  readonly devOnly: readonly string[];
  /** Packages whose licence field is wrong upstream, checked by hand: name → SPDX ID. */
  readonly corrections: Readonly<Record<string, string>>;
}

/** One installed package and its declared licence. */
export interface InstalledPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly licence: string;
}

function tokenize(expression: string): string[] {
  return expression.replace(/[()]/g, " $& ").trim().split(/\s+/).filter(Boolean);
}

/**
 * True when a licence expression can be satisfied with allowed licences:
 * one side of an `OR` is enough, both sides of an `AND` are needed.
 * `WITH` exceptions are judged by their licence. Anything unparsable is false.
 *
 * @example
 * isAllowedExpression("(MIT OR GPL-3.0)", new Set(["MIT"])) // true
 */
export function isAllowedExpression(expression: string, allowed: ReadonlySet<string>): boolean {
  const tokens = tokenize(expression);
  let position = 0;
  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[position]?.toUpperCase() === "OR") {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  const parseAnd = (): boolean => {
    let result = parseTerm();
    while (tokens[position]?.toUpperCase() === "AND") {
      position += 1;
      const right = parseTerm();
      result = result && right;
    }
    return result;
  };
  const parseTerm = (): boolean => {
    const token = tokens[position];
    position += 1;
    if (token === "(") {
      const inner = parseOr();
      if (tokens[position] !== ")") {
        throw new Error("unbalanced parentheses");
      }
      position += 1;
      return inner;
    }
    if (token === undefined || token === ")") {
      throw new Error("missing licence");
    }
    if (tokens[position]?.toUpperCase() === "WITH") {
      position += 2;
    }
    return allowed.has(token);
  };
  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

/** The packages whose licence isn't on the list, with a message that says what to do. */
export function findLicenceProblems(
  installed: readonly InstalledPackage[],
  policy: LicencePolicy,
  kind: "shipped" | "dev",
): string[] {
  const allowed = new Set(
    kind === "shipped" ? policy.shipped : [...policy.shipped, ...policy.devOnly],
  );
  const problems: string[] = [];
  for (const pkg of installed) {
    const licence = policy.corrections[pkg.name] ?? pkg.licence;
    if (!isAllowedExpression(licence, allowed)) {
      const where = kind === "shipped" ? "code we ship" : "dev tooling";
      problems.push(
        `${pkg.name}@${pkg.versions.join(", ")} is licensed "${licence}", which isn't allowed in ${where}. Pick another package, or ask Julian to review the licence and add it to tooling/check/licences.json (plan 11).`,
      );
    }
  }
  return problems;
}
