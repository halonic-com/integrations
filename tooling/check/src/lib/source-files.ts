import ts from "@typescript/typescript6";

/** One import, export-from, dynamic import or `require` in a source file. */
export interface ImportReference {
  readonly specifier: string;
  readonly line: number;
}

/** A function or method and how many lines it spans. */
export interface FunctionSpan {
  readonly name: string;
  readonly line: number;
  readonly lineCount: number;
}

/** The facts the rules need from one TypeScript or JavaScript file. */
export interface SourceFacts {
  readonly imports: readonly ImportReference[];
  readonly functions: readonly FunctionSpan[];
}

/** File endings the parser reads. */
export const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** True when the file is TypeScript or JavaScript source. */
export function isSourceFile(file: string): boolean {
  return sourceExtensions.some((extension) => file.endsWith(extension));
}

/**
 * Test files may use dev tooling such as Vitest. They end in `.test.ts`
 * or live in a `test/` folder.
 */
export function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || /(?:^|\/)tests?\//.test(file);
}

/**
 * Parses a file with the TypeScript parser (not a regex, plan 4.1) and
 * returns its imports and functions.
 */
export function readSourceFacts(fileName: string, text: string): SourceFacts {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const imports: ImportReference[] = [];
  const functions: FunctionSpan[] = [];
  const lineOf = (position: number): number =>
    source.getLineAndCharacterOfPosition(position).line + 1;

  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierOf(node);
    if (specifier !== undefined) {
      imports.push({ specifier: specifier.text, line: lineOf(specifier.getStart(source)) });
    }
    if (isFunctionLike(node) && node.body !== undefined) {
      const start = lineOf(node.getStart(source));
      const end = lineOf(node.getEnd());
      functions.push({ name: functionName(node), line: start, lineCount: end - start + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, functions };
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (/\.[cm]?js$/.test(fileName)) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function moduleSpecifierOf(node: ts.Node): ts.StringLiteralLike | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return ts.isStringLiteralLike(expression) ? expression : undefined;
  }
  if (ts.isImportTypeNode(node)) {
    const argument = node.argument;
    if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
      return argument.literal;
    }
    return undefined;
  }
  if (ts.isCallExpression(node) && isImportOrRequire(node)) {
    const first = node.arguments[0];
    return first !== undefined && ts.isStringLiteralLike(first) ? first : undefined;
  }
  return undefined;
}

function isImportOrRequire(call: ts.CallExpression): boolean {
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  return ts.isIdentifier(call.expression) && call.expression.text === "require";
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionName(node: FunctionNode): string {
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
    return node.name.text;
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return "(anonymous)";
}

/**
 * Splits a bare import like `@scope/name/sub/path` into the package name
 * and the subpath (`./sub/path`, or `.` for the package itself).
 */
export function splitBareSpecifier(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/");
  const rest = parts.slice(nameLength).join("/");
  return { name, subpath: rest === "" ? "." : `./${rest}` };
}
