import { baseConfigs, baseIgnores } from "@cinakey/config/eslint/base.js";
export default [
  ...baseConfigs,
  { ignores: baseIgnores },
  {
    files: [
      "src/runtime/**/*.ts",
      "src/operations.ts",
      "src/app.ts",
      "src/worker.ts",
      "src/app.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
