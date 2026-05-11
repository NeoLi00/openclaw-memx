import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Command } from "commander";
import plugin from "../dist/index.mjs";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

test("memx setup grants conversation access while preserving hook settings", async () => {
  let registerCliCallback;
  await plugin.register({
    config: {
      plugins: {
        entries: {
          "memory-memx": {
            hooks: {
              timeoutMs: 45000,
            },
          },
        },
      },
    },
    pluginConfig: {},
    logger: createLogger(),
    registerTool() {},
    registerCli(callback) {
      registerCliCallback = callback;
    },
    on() {},
    registerService() {},
  });

  assert.equal(typeof registerCliCallback, "function");

  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut() {},
    writeErr() {},
  });
  registerCliCallback({ program });

  const tempDir = await mkdtemp(join(tmpdir(), "memx-setup-"));
  const configPath = join(tempDir, "openclaw.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        plugins: {
          entries: {
            "memory-memx": {
              hooks: {
                timeoutMs: 45000,
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await program.parseAsync(["node", "openclaw", "memx", "setup", "--config", configPath], {
    from: "node",
  });

  const result = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(
    result.plugins?.entries?.["memory-memx"]?.hooks?.allowConversationAccess,
    true,
  );
  assert.equal(result.plugins?.entries?.["memory-memx"]?.hooks?.timeoutMs, 45000);
});
