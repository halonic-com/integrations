import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * The shared Vitest settings for every package. Each package's
 * `vitest.config.ts` calls this so test runs behave the same everywhere.
 *
 * @param overrides - settings for this one package, merged over the preset
 * @returns the Vitest config for the package
 *
 * @example
 * export default definePackageTestConfig();
 */
export function definePackageTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  const preset = defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      environment: "node",
      // A test that never ran must not count as passing.
      passWithNoTests: false,
      // Tests may not depend on the order they run in.
      sequence: { shuffle: true },
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      reporters: process.env["CI"] ? ["default", "github-actions"] : ["default"],
    },
  });
  return mergeConfig(preset, overrides);
}
