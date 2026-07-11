import { defineConfig, defaultExclude } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...defaultExclude, "**/.worktrees/**", "**/.pnpm-store/**"],
  },
});
