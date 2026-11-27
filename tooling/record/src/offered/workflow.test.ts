import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowsFolder = join(import.meta.dirname, "..", "..", "..", "..", ".github", "workflows");

interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions?: unknown;
  readonly jobs: Record<
    string,
    {
      readonly permissions?: unknown;
      readonly steps: { readonly uses?: string; readonly with?: Record<string, unknown> }[];
    }
  >;
}

function read(name: string): { text: string; workflow: Workflow } {
  const text = readFileSync(join(workflowsFolder, name), "utf8");
  return { text, workflow: parse(text) as Workflow };
}

/**
 * The workflows that read a pull request touching integrations/offered/,
 * which mostly comes from a fork (tooling/record/src/offered/check-offered.ts).
 */
describe("the workflows that read offered integrations", () => {
  it.each(["offered.yml", "ci.yml"])(
    "%s runs on pull_request, never pull_request_target",
    (name) => {
      const { workflow } = read(name);
      expect(Object.keys(workflow.on)).toContain("pull_request");
      expect(Object.keys(workflow.on)).not.toContain("pull_request_target");
    },
  );

  it("offered.yml holds no repository credentials", () => {
    const { text, workflow } = read("offered.yml");
    expect(workflow.permissions).toEqual({});
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toEqual({});
      for (const step of job.steps.filter((step) => step.uses?.startsWith("actions/checkout@"))) {
        expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
    expect(text).not.toMatch(/secrets\.|github\.token|GITHUB_TOKEN/);
  });
});
