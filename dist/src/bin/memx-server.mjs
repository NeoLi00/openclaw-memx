#!/usr/bin/env node
import { startMemxHttpServer } from "../host/httpServer.mjs";
//#region src/bin/memx-server.ts
startMemxHttpServer().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
//#endregion
export {};
