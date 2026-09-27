import { baseConfigs, baseIgnores } from "@cinakey/config/eslint/base.js";

export default [
  ...baseConfigs,
  { ignores: [...baseIgnores, "convex/_generated/**"] },
];
