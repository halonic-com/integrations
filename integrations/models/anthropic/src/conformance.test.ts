import { describeIntegrationConformance } from "@halonicjs/testing/integration";
import { readSheetData } from "@halonicjs/tooling-record/sheet-data";
import { readSources } from "@halonicjs/tooling-record/sources";
import { anthropic } from "./index.ts";

/**
 * The shared conformance suite (guide, section 9), on the Anthropic provider. It is a model
 * provider with no tools, so there are no cases to replay: the suite checks
 * the code against the sheet and scans the sources. Requests and answers are
 * covered by `provider.test.ts`, from the recordings.
 */

describeIntegrationConformance({
  integration: anthropic,
  sheet: readSheetData(new URL("../integration.yaml", import.meta.url)),
  recordings: [],
  cases: [],
  // In-repo packages the build bundles into this integration.
  bundled: ["@halonicjs/integration-shared"],
  sources: {
    ...readSources(new URL("./", import.meta.url), "models/anthropic/src"),
    ...readSources(new URL("../../../shared/src/", import.meta.url), "shared/src"),
  },
});
