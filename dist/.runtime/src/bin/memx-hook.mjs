#!/usr/bin/env node
//#region src/bin/memx-hook.ts
async function main() {
	const { runMemxHook } = await import("../host/hookRunner.mjs");
	await runMemxHook();
}
main().catch((error) => {
	if (process.env["MEMX_HOOK_DEBUG"] === "1") console.error(error instanceof Error ? error.message : String(error));
	process.exit(0);
});
//#endregion
export {};
