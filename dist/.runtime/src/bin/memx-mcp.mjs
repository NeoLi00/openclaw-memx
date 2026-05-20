#!/usr/bin/env node
import { startMcpStdio } from "../host/mcpStdio.mjs";
//#region src/bin/memx-mcp.ts
startMcpStdio().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
//#endregion
export {};
