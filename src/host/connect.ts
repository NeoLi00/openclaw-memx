import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MEMX_INSTALL_SPEC } from "../identity.js";

const PACKAGE_SPEC = MEMX_INSTALL_SPEC;
const DEFAULT_URL = "http://127.0.0.1:3878";
const CODEX_SECTION = "[mcp_servers.memx]";
const CODEX_ENV_SECTION = "[mcp_servers.memx.env]";

export type McpCommandConfig = {
  command: string;
  args: string[];
};

export type McpToolsProfile = "full" | "lifecycle-safe" | "none";

export type GenericMcpConfig = {
  mcpServers: {
    memx: {
      command: string;
      args: string[];
      env: {
        MEMX_URL: string;
        MEMX_SECRET: string;
        MEMX_MCP_TOOLS: McpToolsProfile;
      };
    };
  };
};

function defaultMcpCommand(): McpCommandConfig {
  return {
    command: "npx",
    args: ["-y", "-p", PACKAGE_SPEC, "memx-mcp"],
  };
}

export function buildGenericMcpConfig(
  url = "${MEMX_URL}",
  secret = "${MEMX_SECRET}",
  commandConfig = defaultMcpCommand(),
  mcpTools: McpToolsProfile = "full",
): GenericMcpConfig {
  return {
    mcpServers: {
      memx: {
        command: commandConfig.command,
        args: commandConfig.args,
        env: {
          MEMX_URL: url,
          MEMX_SECRET: secret,
          MEMX_MCP_TOOLS: mcpTools,
        },
      },
    },
  };
}

export function hasCodexMemxBlock(toml: string): boolean {
  return toml.includes(CODEX_SECTION);
}

function stripCodexMemxBlock(toml: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of toml.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === CODEX_SECTION || trimmed === CODEX_ENV_SECTION) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith("[") && trimmed !== CODEX_ENV_SECTION) {
      skipping = false;
    }
    if (!skipping) {
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n{3,}$/u, "\n\n").trimEnd();
}

export function applyCodexTomlDisconnect(toml: string): string {
  return stripCodexMemxBlock(toml);
}

export function applyCodexTomlConnect(
  toml: string,
  url = DEFAULT_URL,
  secret = "${MEMX_SECRET}",
  commandConfig = defaultMcpCommand(),
  mcpTools: McpToolsProfile = "full",
): string {
  const cleaned = stripCodexMemxBlock(toml);
  const block = [
    CODEX_SECTION,
    `command = ${JSON.stringify(commandConfig.command)}`,
    `args = ${JSON.stringify(commandConfig.args)}`,
    "",
    CODEX_ENV_SECTION,
    `MEMX_URL = "${url}"`,
    `MEMX_SECRET = "${secret}"`,
    `MEMX_MCP_TOOLS = "${mcpTools}"`,
    "",
  ].join("\n");
  return `${cleaned}${cleaned ? "\n\n" : ""}${block}`;
}

export function applyClaudeJsonConnect(
  input: unknown,
  url = "${MEMX_URL}",
  secret = "${MEMX_SECRET}",
  commandConfig = defaultMcpCommand(),
  mcpTools: McpToolsProfile = "full",
): Record<string, unknown> {
  const base =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  const currentServers =
    base.mcpServers && typeof base.mcpServers === "object" && !Array.isArray(base.mcpServers)
      ? (base.mcpServers as Record<string, unknown>)
      : {};
  return {
    ...base,
    mcpServers: {
      ...currentServers,
      memx: buildGenericMcpConfig(url, secret, commandConfig, mcpTools).mcpServers.memx,
    },
  };
}

export function applyClaudeJsonDisconnect(input: unknown): Record<string, unknown> {
  const base =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  const currentServers =
    base.mcpServers && typeof base.mcpServers === "object" && !Array.isArray(base.mcpServers)
      ? { ...(base.mcpServers as Record<string, unknown>) }
      : {};
  delete currentServers.memx;
  return {
    ...base,
    mcpServers: currentServers,
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

export function connectCodexConfig(
  configPath = join(homedir(), ".codex", "config.toml"),
  url = DEFAULT_URL,
  secret = "${MEMX_SECRET}",
): string {
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const next = applyCodexTomlConnect(current, url, secret);
  writeAtomic(configPath, next);
  return configPath;
}

export function connectClaudeCodeConfig(
  configPath = join(homedir(), ".claude.json"),
  url = "${MEMX_URL}",
  secret = "${MEMX_SECRET}",
): string {
  const current = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const next = applyClaudeJsonConnect(current, url, secret);
  writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return configPath;
}
