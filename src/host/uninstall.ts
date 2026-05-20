import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applyClaudeJsonDisconnect, applyCodexTomlDisconnect } from "./connect.js";
import { LEGACY_MEMX_PLUGIN_ID, MEMX_PLUGIN_ID, withoutLegacyPluginIds } from "../identity.js";

const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
const DEFAULT_CLAUDE_CONFIG_PATH = join(homedir(), ".claude.json");

type OpenClawConfigLike = {
  plugins?: {
    allow?: string[];
    slots?: Record<string, string>;
    entries?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type UninstallCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};

export type UninstallDeps = {
  now?: () => number;
  runCommand?: (command: string, args: string[]) => Promise<UninstallCommandResult>;
};

export type OpenClawUninstallOptions = {
  configPath?: string;
  openclawBin?: string;
  skipPluginUninstall?: boolean;
  dryRun?: boolean;
};

export type StandaloneUninstallOptions = {
  configPath?: string;
  codexBin?: string;
  dryRun?: boolean;
};

function asOpenClawConfig(input: unknown): OpenClawConfigLike {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (structuredClone(input) as OpenClawConfigLike)
    : {};
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isMemxId(value: string | undefined): boolean {
  return value === MEMX_PLUGIN_ID || value === LEGACY_MEMX_PLUGIN_ID;
}

export function applyOpenClawUninstallConfig(input: unknown): OpenClawConfigLike {
  const next = asOpenClawConfig(input);
  const plugins = { ...(next.plugins ?? {}) };
  const slots = { ...(plugins.slots ?? {}) };
  if (isMemxId(slots.memory)) {
    delete slots.memory;
  }
  const entries = { ...(plugins.entries ?? {}) };
  delete entries[MEMX_PLUGIN_ID];
  delete entries[LEGACY_MEMX_PLUGIN_ID];

  return {
    ...next,
    plugins: {
      ...plugins,
      slots,
      allow: withoutLegacyPluginIds(plugins.allow).filter((value) => value !== MEMX_PLUGIN_ID),
      entries,
    },
  };
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

async function backupIfExists(path: string, now: () => number): Promise<string | null> {
  if (!existsSync(path)) {
    return null;
  }
  const backupPath = `${path}.bak.${now()}`;
  await copyFile(path, backupPath);
  return backupPath;
}

async function defaultRunCommand(command: string, args: string[]): Promise<UninstallCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      resolve({ code: 1, stderr: error.message });
    });
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function warningForFailedUninstall(result: UninstallCommandResult): string {
  const detail = (result.stderr || result.stdout || "").trim();
  return `plugin uninstall exited ${result.code}${detail ? `: ${detail}` : ""}`;
}

function stripTomlSection(toml: string, header: string): string {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return toml.replace(new RegExp(`\\n?${escaped}\\n[\\s\\S]*?(?=\\n\\[|$)`, "u"), "");
}

function applyCodexPluginDisconnect(toml: string): string {
  return stripTomlSection(
    stripTomlSection(toml, '[plugins."memx@memx"]'),
    "[marketplaces.memx]",
  ).trim();
}

export async function runOpenClawUninstall(
  rawOptions: OpenClawUninstallOptions = {},
  deps: UninstallDeps = {},
): Promise<Record<string, unknown>> {
  const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_OPENCLAW_CONFIG_PATH;
  const openclawBin = trimOrUndefined(rawOptions.openclawBin) ?? "openclaw";
  const now = deps.now ?? Date.now;
  const dryRun = Boolean(rawOptions.dryRun);
  const current = existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : {};
  const next = applyOpenClawUninstallConfig(current);
  const warnings: string[] = [];
  let backupPath: string | null = null;

  if (!dryRun) {
    backupPath = await backupIfExists(configPath, now);
    await writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (!rawOptions.skipPluginUninstall) {
      const runCommand = deps.runCommand ?? defaultRunCommand;
      const result = await runCommand(openclawBin, [
        "plugins",
        "uninstall",
        MEMX_PLUGIN_ID,
        "--force",
      ]);
      if (result.code !== 0) {
        warnings.push(warningForFailedUninstall(result));
      }
    }
  }

  return {
    ok: true,
    target: "openclaw",
    dryRun,
    configPath,
    backupPath,
    warnings,
    removed: {
      slot: current?.plugins?.slots?.memory === MEMX_PLUGIN_ID,
      legacySlot: current?.plugins?.slots?.memory === LEGACY_MEMX_PLUGIN_ID,
      entry: Boolean(current?.plugins?.entries?.[MEMX_PLUGIN_ID]),
      legacyEntry: Boolean(current?.plugins?.entries?.[LEGACY_MEMX_PLUGIN_ID]),
      allow: Array.isArray(current?.plugins?.allow)
        ? current.plugins.allow.filter(isMemxId).length
        : 0,
    },
  };
}

export async function runCodexUninstall(
  rawOptions: StandaloneUninstallOptions = {},
  deps: Pick<UninstallDeps, "now" | "runCommand"> = {},
): Promise<Record<string, unknown>> {
  const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_CODEX_CONFIG_PATH;
  const codexBin = trimOrUndefined(rawOptions.codexBin) ?? "codex";
  const now = deps.now ?? Date.now;
  const dryRun = Boolean(rawOptions.dryRun);
  const current = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  const next = applyCodexPluginDisconnect(applyCodexTomlDisconnect(current));
  let backupPath: string | null = null;
  const warnings: string[] = [];
  if (!dryRun) {
    backupPath = await backupIfExists(configPath, now);
    await writeAtomic(configPath, next ? `${next}\n` : "");
    const runCommand = deps.runCommand ?? defaultRunCommand;
    for (const args of [
      ["plugin", "remove", "memx@memx"],
      ["plugin", "marketplace", "remove", "memx"],
    ]) {
      const result = await runCommand(codexBin, args);
      if (result.code !== 0) {
        warnings.push(warningForFailedUninstall(result));
      }
    }
  }
  return {
    ok: true,
    target: "codex",
    dryRun,
    configPath,
    backupPath,
    warnings,
    removed: current !== next,
  };
}

export async function runClaudeCodeUninstall(
  rawOptions: StandaloneUninstallOptions = {},
  deps: Pick<UninstallDeps, "now"> = {},
): Promise<Record<string, unknown>> {
  const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_CLAUDE_CONFIG_PATH;
  const now = deps.now ?? Date.now;
  const dryRun = Boolean(rawOptions.dryRun);
  const current = existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : {};
  const next = applyClaudeJsonDisconnect(current);
  let backupPath: string | null = null;
  if (!dryRun) {
    backupPath = await backupIfExists(configPath, now);
    await writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return {
    ok: true,
    target: "claude-code",
    dryRun,
    configPath,
    backupPath,
    removed: Boolean(
      current?.mcpServers &&
        typeof current.mcpServers === "object" &&
        !Array.isArray(current.mcpServers) &&
        current.mcpServers.memx,
    ),
  };
}
