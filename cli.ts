#!/usr/bin/env tsx

import { main } from "./src/cli.js";

export * from "./src/index.js";

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  main().catch((err: Error) => {
    console.error("\nUnexpected error:", err?.message || err);
    process.exit(1);
  });
}
