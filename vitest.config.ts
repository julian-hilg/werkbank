import { defineConfig } from "vitest/config";

export default defineConfig({ resolve: { conditions: ["werkbank-source"] }, test: { include: ["packages/*/test/**/*.test.ts", "starter/test/**/*.test.ts"], environment: "node" } });
