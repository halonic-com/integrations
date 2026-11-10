/**
 * Which integration is built on this library: its sheet's `id` and
 * `version`. The same code serves the "on this computer" and "online"
 * entries, which differ only in their sheet and this.
 */
export interface IntegrationEntry {
  /** The sheet's `id`, such as `tool-mcp-http`. */
  readonly name: string;
  /** The sheet's `version`. */
  readonly version: string;
}

/** How we introduce ourselves to the server: `halonic-` and the sheet's `id`. */
export function clientInfoOf(entry: IntegrationEntry): { name: string; version: string } {
  return { name: `halonic-${entry.name}`, version: entry.version };
}
