#!/usr/bin/env node
import { runMemxHook } from "../host/hookRunner.mjs";
//#region src/bin/memx-hook.ts
runMemxHook().catch((error) => {
	if (process.env["MEMX_HOOK_DEBUG"] === "1") console.error(error instanceof Error ? error.message : String(error));
	process.exit(0);
});
//#endregion
export {};
