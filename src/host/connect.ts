import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE_NAME = "@neoli00/memory-memx";
const DEFAULT_URL = "http://localhost:3878";
const CODEX_SECTION = "[mcp_servers.memx]";
const CODEX_ENV_SECTION = "[mcp_servers.memx.env]";

export type GenericMcpConfig = {
  mcpServers: {
    memx: {
      command: "npx";
      args: string[];
      env: {
        MEMX_URL: string;
        MEMX_SECRET: string;
      };
    };
  };
};

export function buildGenericMcpConfig(): GenericMcpConfig {
  return {
    mcpServers: {
      memx: {
        command: "npx",
        args: ["-y", "-p", PACKAGE_NAME, "memx-mcp"],
        env: {
          MEMX_URL: "${MEMX_URL}",
          MEMX_SECRET: "${MEMX_SECRET}",
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

export function applyCodexTomlConnect(toml: string, url = DEFAULT_URL): string {
  const cleaned = stripCodexMemxBlock(toml);
  const block = [
    CODEX_SECTION,
    'command = "npx"',
    `args = ["-y", "-p", "${PACKAGE_NAME}", "memx-mcp"]`,
    "",
    CODEX_ENV_SECTION,
    `MEMX_URL = "${url}"`,
    'MEMX_SECRET = "${MEMX_SECRET}"',
    "",
  ].join("\n");
  return `${cleaned}${cleaned ? "\n\n" : ""}${block}`;
}

export function applyClaudeJsonConnect(input: unknown): Record<string, unknown> {
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
      memx: buildGenericMcpConfig().mcpServers.memx,
    },
  };
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

export function connectCodexConfig(configPath = join(homedir(), ".codex", "config.toml")): string {
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const next = applyCodexTomlConnect(current);
  writeAtomic(configPath, next);
  return configPath;
}

export function connectClaudeCodeConfig(configPath = join(homedir(), ".claude.json")): string {
  const current = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const next = applyClaudeJsonConnect(current);
  writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return configPath;
}
