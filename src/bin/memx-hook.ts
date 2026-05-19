#!/usr/bin/env node

import { runMemxHook } from "../host/hookRunner.js";

runMemxHook().catch((error) => {
  if (process.env["MEMX_HOOK_DEBUG"] === "1") {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(0);
});
