#!/usr/bin/env node

import { startMcpStdio } from "../host/mcpStdio.js";

startMcpStdio().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
