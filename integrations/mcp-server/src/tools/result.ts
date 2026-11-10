import type { McpContent, McpToolResult } from "@halonicjs/integration-mcp";
import { cutText } from "@halonicjs/integration-shared";
import { maxResultChars } from "./limits.ts";

/**
 * The kinds of content we name in a note. Any other kind is the server's
 * own word, so it is called "other" rather than repeated.
 */
const knownKinds = new Set(["image", "audio", "resource", "resource_link"]);

/**
 * A tool's answer as the text the model reads: its text parts, one per
 * line, cut to {@link maxResultChars}. A part that isn't text is named in
 * a note at the end, so the model knows something was left out.
 */
export function toResultText(result: McpToolResult): string {
  const texts: string[] = [];
  const leftOut = new Set<string>();
  for (const part of result.content) {
    if (part.type === "text") {
      texts.push(part.text);
    } else {
      leftOut.add(kindName(part));
    }
  }
  if (leftOut.size > 0) {
    texts.push(
      `[The tool also returned ${[...leftOut].join(", ")} content, which Halonic doesn't pass on yet.]`,
    );
  }
  return cutText(texts.join("\n"), maxResultChars);
}

function kindName(part: Extract<McpContent, { type: "other" }>): string {
  return knownKinds.has(part.kind) ? part.kind.replace("_", " ") : "other";
}
