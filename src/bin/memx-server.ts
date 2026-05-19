#!/usr/bin/env node

import { startMemxHttpServer } from "../host/httpServer.js";

startMemxHttpServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
