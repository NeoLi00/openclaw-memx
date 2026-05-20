#!/usr/bin/env node

async function main(): Promise<void> {
  const { runMemxHook } = await import("../host/hookRunner.js");
  await runMemxHook();
}

main().catch((error) => {
  if (process.env["MEMX_HOOK_DEBUG"] === "1") {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(0);
});
