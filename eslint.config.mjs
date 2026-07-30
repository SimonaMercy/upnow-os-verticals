import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The e2e Playwright runs build into `.next-e2e`, which the default list
    // does not cover — so linting the project reported ~1,221 errors from
    // bundled and generated output (no-this-alias, no-require-imports,
    // no-assign-module-variable) that no one wrote and no one can fix. That
    // noise is 85% of the project's error count and buries the ~193 real ones.
    ".next-e2e/**",
  ]),
]);

export default eslintConfig;
