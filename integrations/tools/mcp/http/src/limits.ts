/**
 * Limits on what the server sends and we pass on. Tool lists and results
 * go into the model's context, so every text has a limit (guide, section
 * 5), whatever the server sends. The MCP client already limits the list
 * to 200 tools in at most 10 pages.
 */

/** A tool's description: room for a clear one, not for a manual. */
export const maxDescriptionChars = 2_000;

/**
 * A tool's argument schema, as JSON. It goes into the context with every
 * request, so a larger one is refused rather than passed on; cutting would
 * break it.
 */
export const maxParametersChars = 20_000;

/**
 * How deeply a tool's argument schema may nest objects and arrays. Real
 * schemas stay within a handful of levels; thousands of levels fit within
 * {@link maxParametersChars} but break `JSON.stringify` and every other
 * step that walks the schema.
 */
export const maxParametersDepth = 64;

/**
 * The whole tool list: descriptions plus argument schemas as JSON, about
 * 50,000 tokens. The list goes into the context on every turn, so a server
 * whose tools are each within their limits can't add up to millions of
 * characters. A larger list is refused, as one with too many tools is.
 */
export const maxToolListChars = 200_000;

/**
 * A tool's result: about 12,000 tokens. Lower than a knowledge document's
 * limit, because a result stays in the conversation for every later turn.
 */
export const maxResultChars = 50_000;
