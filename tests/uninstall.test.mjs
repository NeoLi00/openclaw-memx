import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("OpenClaw uninstall removes memx slot, entries, and allow items", async () => {
  const { applyOpenClawUninstallConfig } = await import(
    "../dist/.runtime/src/host/uninstall.mjs"
  );

  const next = applyOpenClawUninstallConfig({
    plugins: {
      slots: { memory: "memx", other: "kept" },
      allow: ["memx", "memory-memx", "other"],
      entries: {
        memx: { enabled: true },
        "memory-memx": { enabled: true },
        other: { enabled: true },
      },
    },
  });

  assert.deepEqual(next.plugins.slots, { other: "kept" });
  assert.deepEqual(next.plugins.allow, ["other"]);
  assert.deepEqual(next.plugins.entries, { other: { enabled: true } });
});

test("Codex uninstall removes only memx MCP TOML sections", async () => {
  const { applyCodexTomlDisconnect, hasCodexMemxBlock } = await import(
    "../dist/.runtime/src/host/connect.mjs"
  );

  const before = [
    '[mcp_servers.other]',
    'command = "node"',
    "",
    "[mcp_servers.memx]",
    'command = "npx"',
    'args = ["-y", "-p", "@neoli00/memx", "memx-mcp"]',
    "",
    "[mcp_servers.memx.env]",
    'MEMX_URL = "http://localhost:3878"',
    "",
    "[tools]",
    'enabled = true',
  ].join("\n");

  const next = applyCodexTomlDisconnect(before);
  assert.equal(hasCodexMemxBlock(next), false);
  assert.match(next, /\[mcp_servers\.other\]/);
  assert.match(next, /\[tools\]/);
});

test("Codex uninstall removes memx plugin and marketplace config", async () => {
  const { runCodexUninstall } = await import("../dist/.runtime/src/host/uninstall.mjs");
  const dir = mkdtempSync(join(tmpdir(), "memx-codex-uninstall-"));
  const configPath = join(dir, "config.toml");
  const codexMarketplaceDir = join(dir, ".memx", "codex-marketplace");
  mkdirSync(codexMarketplaceDir, { recursive: true });
  writeFileSync(join(codexMarketplaceDir, "marker.txt"), "stale", "utf8");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      configPath,
      [
        '[mcp_servers.memx]',
        'command = "node"',
        "",
        '[plugins."memx@memx"]',
        "enabled = true",
        "",
        "[marketplaces.memx]",
        'source = "/tmp/memx"',
        "",
        "[projects.foo]",
        'trust_level = "trusted"',
      ].join("\n"),
    ),
  );
  const calls = [];

  const result = await runCodexUninstall(
    { configPath, codexBin: "codex-test", codexMarketplaceDir },
    {
      now: () => 123,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { code: 0 };
      },
    },
  );

  const written = readFileSync(configPath, "utf8");
  assert.doesNotMatch(written, /memx/);
  assert.match(written, /\[projects\.foo\]/);
  assert.deepEqual(calls, [
    { command: "codex-test", args: ["plugin", "remove", "memx@memx"] },
    { command: "codex-test", args: ["plugin", "marketplace", "remove", "memx"] },
  ]);
  assert.equal(result.backupPath, `${configPath}.bak.123`);
  assert.equal(existsSync(codexMarketplaceDir), false);
});

test("Claude Code uninstall removes memx MCP server, native plugin, and marketplace", async () => {
  const { applyClaudeJsonDisconnect } = await import(
    "../dist/.runtime/src/host/connect.mjs"
  );
  const { runClaudeCodeUninstall } = await import("../dist/.runtime/src/host/uninstall.mjs");

  const next = applyClaudeJsonDisconnect({
    theme: "dark",
    mcpServers: {
      memx: { command: "npx" },
      other: { command: "node" },
    },
  });

  assert.deepEqual(next, {
    theme: "dark",
    mcpServers: {
      other: { command: "node" },
    },
  });

  const dir = mkdtempSync(join(tmpdir(), "memx-claude-uninstall-"));
  const configPath = join(dir, "claude.json");
  const claudeMarketplaceDir = join(dir, ".memx", "claude-marketplace");
  mkdirSync(claudeMarketplaceDir, { recursive: true });
  writeFileSync(join(claudeMarketplaceDir, "marker.txt"), "stale", "utf8");
  writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        memx: { command: "node" },
        other: { command: "node" },
      },
    }),
    "utf8",
  );
  const calls = [];

  const result = await runClaudeCodeUninstall(
    { configPath, claudeBin: "claude-test", claudeMarketplaceDir },
    {
      now: () => 123,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { code: 0 };
      },
    },
  );

  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(written.mcpServers, { other: { command: "node" } });
  assert.deepEqual(calls, [
    { command: "claude-test", args: ["plugin", "uninstall", "memx@memx"] },
    { command: "claude-test", args: ["plugin", "uninstall", "memx"] },
    { command: "claude-test", args: ["plugin", "marketplace", "remove", "memx"] },
  ]);
  assert.equal(result.backupPath, `${configPath}.bak.123`);
  assert.equal(existsSync(claudeMarketplaceDir), false);
});

test("OpenClaw uninstall backs up config and treats plugin uninstall as best effort", async () => {
  const { runOpenClawUninstall } = await import("../dist/.runtime/src/host/uninstall.mjs");
  const dir = mkdtempSync(join(tmpdir(), "memx-uninstall-"));
  const configPath = join(dir, "openclaw.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      configPath,
      JSON.stringify({
        plugins: {
          slots: { memory: "memx" },
          allow: ["memx"],
          entries: { memx: { enabled: true } },
        },
      }),
    ),
  );
  const calls = [];

  const result = await runOpenClawUninstall(
    { configPath },
    {
      now: () => 123,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { code: 1, stderr: "not installed" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.backupPath, `${configPath}.bak.123`);
  assert.equal(existsSync(`${configPath}.bak.123`), true);
  assert.deepEqual(calls, [
    { command: "openclaw", args: ["plugins", "uninstall", "memx", "--force"] },
    { command: "openclaw", args: ["plugins", "uninstall", "memory-memx", "--force"] },
  ]);
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.plugins.slots.memory, undefined);
  assert.deepEqual(result.warnings, []);
});
