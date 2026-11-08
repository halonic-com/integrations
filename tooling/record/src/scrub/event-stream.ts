import type { JsonValue, StreamEvent } from "./exchange.ts";

/**
 * Reads a `text/event-stream` body (server-sent events), as model providers
 * and remote MCP servers stream their answers. Our own small reader of the
 * format, no library:
 * - events are separated by a blank line
 * - `event:` names the event (`message` when absent), `data:` lines are
 *   joined with a line break
 * - comments (`:`), `id:` and `retry:` are left out: replay doesn't need them
 *
 * `data` that holds a JSON object or list is parsed, so the scrubber can see
 * the field names inside each event.
 */
export function parseEventStream(text: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const event = parseBlock(block);
    if (event !== undefined) {
      events.push(event);
    }
  }
  return events;
}

function parseBlock(block: string): StreamEvent | undefined {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") {
      name = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  // An event without data is never delivered to a listener, so it isn't kept.
  return data.length === 0 ? undefined : { event: name, data: parseData(data.join("\n")) };
}

function parseData(data: string): JsonValue {
  const trimmed = data.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return data;
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return data;
  }
}
