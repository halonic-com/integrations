import { defineConfig } from "vitest/config";

// The main repo's shared preset (tooling/config/src/vitest-preset.ts), copied
// until I1 brings @halonicjs/tooling-config here; then this calls
// definePackageTestConfig() instead.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // A test that never ran must not count as passing.
    passWithNoTests: false,
    // Tests may not depend on the order they run in.
    sequence: { shuffle: true },
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
