import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const rootPath = root.pathname;

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(rootPath, relativePath), "utf8"));
}

function collectCommandHooks(hooksConfig) {
  const commandHooks = [];
  for (const entries of Object.values(hooksConfig.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        if (hook.type === "command") {
          commandHooks.push(hook);
        }
      }
    }
  }
  return commandHooks;
}

function encodeMcpFrame(payload) {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function decodeMcpFrame(output) {
  const marker = "\r\n\r\n";
  const headerEnd = output.indexOf(marker);
  assert.notEqual(headerEnd, -1);
  const header = output.slice(0, headerEnd);
  const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1]);
  assert.ok(Number.isInteger(length));
  const body = output.slice(headerEnd + marker.length, headerEnd + marker.length + length);
  return JSON.parse(body);
}

test("package ships standalone bins and native plugin assets", () => {
  const pkg = readJson("package.json");

  assert.equal(pkg.name, "@neoli00/memx");
  assert.equal(pkg.openclaw.install.npmSpec, "@neoli00/memx");
  assert.deepEqual(Object.keys(pkg.bin).sort(), [
    "memx",
    "memx-hook",
    "memx-mcp",
    "memx-server",
  ]);
  assert.equal(pkg.bin.memx, "dist/.runtime/src/bin/memx.mjs");
  assert.equal(pkg.bin["memx-mcp"], "dist/.runtime/src/bin/memx-mcp.mjs");

  for (const path of [".codex-plugin", ".claude-plugin", ".mcp.json", "hooks", "skills"]) {
    assert.ok(pkg.files.includes(path), `package files must include ${path}`);
    assert.ok(existsSync(join(rootPath, path)), `${path} should exist`);
  }
});

test("standalone server bundle does not require OpenClaw at runtime", () => {
  const embeddingBackend = readFileSync(
    join(rootPath, "dist/.runtime/src/search/backends/embeddingBackend.mjs"),
    "utf8",
  );

  assert.doesNotMatch(embeddingBackend, /openclaw\/plugin-sdk/);
});

test("Codex native plugin manifest wires MCP and supported hooks only", () => {
  const manifest = readJson(".codex-plugin/plugin.json");
  assert.equal(manifest.name, "memx");
  assert.equal(manifest.homepage, "https://github.com/NeoLi00/memX");
  assert.equal(manifest.repository, "https://github.com/NeoLi00/memX");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.hooks, "./hooks/hooks.codex.json");
  assert.equal(manifest.skills, "./skills/");

  const hooks = readJson("hooks/hooks.codex.json").hooks;
  const supported = new Set([
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "PreCompact",
    "PostCompact",
    "Stop",
  ]);
  assert.deepEqual(Object.keys(hooks).sort(), [
    "PostToolUse",
    "PreCompact",
    "PreToolUse",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]);
  for (const event of Object.keys(hooks)) {
    assert.ok(supported.has(event), `unsupported Codex hook event: ${event}`);
  }
  for (const hook of collectCommandHooks({ hooks })) {
    assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/\.runtime\/src\/bin\/memx-hook\.mjs" codex /);
    assert.equal("args" in hook, false, "Codex hooks should use Codex-compatible command strings");
    assert.equal(hook.timeout, 5);
  }
});

test("Claude Code native plugin manifest keeps Claude-only hooks separate", () => {
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.equal(manifest.name, "memx");
  assert.equal(manifest.homepage, "https://github.com/NeoLi00/memX");
  assert.equal(manifest.repository, "https://github.com/NeoLi00/memX");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.hooks, "./hooks/hooks.json");

  const hooks = readJson("hooks/hooks.json").hooks;
  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "SubagentStart",
    "SubagentStop",
    "Notification",
    "TaskCompleted",
    "Stop",
    "SessionEnd",
  ]) {
    assert.ok(event in hooks, `missing Claude Code hook: ${event}`);
  }
  for (const hook of collectCommandHooks({ hooks })) {
    assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/\.runtime\/src\/bin\/memx-hook\.mjs" claude-code /);
    assert.equal("args" in hook, false, "Claude hooks should use command strings");
    assert.equal(hook.timeout, 5);
  }
});

test("native MCP config runs the local memX MCP binary from plugin root", () => {
  const mcp = readJson(".mcp.json");
  const entry = mcp.mcpServers.memx;
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, ["${CLAUDE_PLUGIN_ROOT}/dist/.runtime/src/bin/memx-mcp.mjs"]);
  assert.equal(entry.env.MEMX_URL, "${MEMX_URL}");
  assert.equal(entry.env.MEMX_SECRET, "${MEMX_SECRET}");
});

test("host protocol normalizes Codex and Claude hooks into the same turn envelope", async () => {
  const { normalizeHookPayload } = await import("../dist/.runtime/src/host/hookPayload.mjs");

  const codex = normalizeHookPayload("codex", "UserPromptSubmit", {
    session_id: "codex-session",
    cwd: "/tmp/project",
    prompt: "请记住 Notebook validator 要支持 pytest",
  });
  assert.equal(codex.hostId, "codex");
  assert.equal(codex.sessionId, "codex-session");
  assert.equal(codex.workspaceDir, "/tmp/project");
  assert.equal(codex.messages[0].role, "user");

  const claude = normalizeHookPayload("claude-code", "PostToolUse", {
    session_id: "claude-session",
    cwd: "/tmp/project",
    tool_name: "Write",
    tool_input: { file_path: "validator.py" },
    tool_response: "ok",
  });
  assert.equal(claude.hostId, "claude-code");
  assert.equal(claude.messages[0].role, "tool");
  assert.equal(claude.messages[0].toolName, "Write");
  assert.match(claude.messages[0].content, /validator\.py/);
});

test("MCP handler exposes memX tools and proxies calls to REST", async () => {
  const { handleMcpRequest } = await import("../dist/.runtime/src/host/mcpProtocol.mjs");
  const calls = [];
  const proxy = async (path, init) => {
    calls.push({ path, init });
    return { ok: true, path };
  };

  const list = await handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { proxy },
  );
  const toolNames = list.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [
    "memx_audit",
    "memx_forget",
    "memx_observe",
    "memx_recall",
    "memx_remember",
    "memx_stats",
  ]);

  const call = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "memx_recall", arguments: { query: "Notebook validator", limit: 3 } },
    },
    { proxy },
  );
  assert.equal(calls[0].path, "/v1/recall");
  assert.equal(JSON.parse(calls[0].init.body).query, "Notebook validator");
  assert.equal(call.result.content[0].type, "text");

  const initialized = await handleMcpRequest({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  assert.equal(initialized, null);
});

test("MCP stdio accepts standard Content-Length framed requests", async () => {
  const child = spawn(process.execPath, [join(rootPath, "dist/.runtime/src/bin/memx-mcp.mjs")], {
    env: {
      ...process.env,
      MEMX_URL: "http://127.0.0.1:9",
      MEMX_SECRET: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.end(
    encodeMcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "node-test", version: "0" },
      },
    }),
  );

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("memx-mcp framed stdio test timed out"));
    }, 5000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, "");
  const response = decodeMcpFrame(stdout);
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, "memx");
  assert.equal(response.result.capabilities.tools instanceof Object, true);
});

test("connect helpers generate Codex TOML and generic MCP JSON without duplicating blocks", async () => {
  const {
    applyCodexTomlConnect,
    buildGenericMcpConfig,
    hasCodexMemxBlock,
  } = await import("../dist/.runtime/src/host/connect.mjs");

  const first = applyCodexTomlConnect("");
  const second = applyCodexTomlConnect(first);
  assert.equal(hasCodexMemxBlock(second), true);
  assert.equal((second.match(/\[mcp_servers\.memx\]/g) ?? []).length, 1);
  assert.match(second, /github:NeoLi00\/memX/);

  const generic = buildGenericMcpConfig();
  assert.equal(generic.mcpServers.memx.command, "npx");
  assert.deepEqual(generic.mcpServers.memx.args, [
    "-y",
    "-p",
    "github:NeoLi00/memX",
    "memx-mcp",
  ]);
});
