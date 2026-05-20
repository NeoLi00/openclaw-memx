import { LEGACY_MEMX_PLUGIN_ID, MEMX_PLUGIN_ID, withoutLegacyPluginIds } from "../identity.mjs";
import { applyClaudeJsonDisconnect, applyCodexTomlDisconnect } from "./connect.mjs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
//#region src/host/uninstall.ts
const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
const DEFAULT_CLAUDE_CONFIG_PATH = join(homedir(), ".claude.json");
function asOpenClawConfig(input) {
	return input && typeof input === "object" && !Array.isArray(input) ? structuredClone(input) : {};
}
function trimOrUndefined(value) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : void 0;
}
function isMemxId(value) {
	return value === "memx" || value === "memory-memx";
}
function applyOpenClawUninstallConfig(input) {
	const next = asOpenClawConfig(input);
	const plugins = { ...next.plugins ?? {} };
	const slots = { ...plugins.slots ?? {} };
	if (isMemxId(slots.memory)) delete slots.memory;
	const entries = { ...plugins.entries ?? {} };
	delete entries[MEMX_PLUGIN_ID];
	delete entries[LEGACY_MEMX_PLUGIN_ID];
	return {
		...next,
		plugins: {
			...plugins,
			slots,
			allow: withoutLegacyPluginIds(plugins.allow).filter((value) => value !== MEMX_PLUGIN_ID),
			entries
		}
	};
}
async function writeAtomic(path, text) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
}
async function backupIfExists(path, now) {
	if (!existsSync(path)) return null;
	const backupPath = `${path}.bak.${now()}`;
	await copyFile(path, backupPath);
	return backupPath;
}
async function defaultRunCommand(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			shell: false,
			stdio: "pipe"
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.once("error", (error) => {
			resolve({
				code: 1,
				stderr: error.message
			});
		});
		child.once("close", (code) => resolve({
			code: code ?? 1,
			stdout,
			stderr
		}));
	});
}
function warningForFailedUninstall(result) {
	const detail = (result.stderr || result.stdout || "").trim();
	return `plugin uninstall exited ${result.code}${detail ? `: ${detail}` : ""}`;
}
async function runOpenClawUninstall(rawOptions = {}, deps = {}) {
	const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_OPENCLAW_CONFIG_PATH;
	const openclawBin = trimOrUndefined(rawOptions.openclawBin) ?? "openclaw";
	const now = deps.now ?? Date.now;
	const dryRun = Boolean(rawOptions.dryRun);
	const current = existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : {};
	const next = applyOpenClawUninstallConfig(current);
	const warnings = [];
	let backupPath = null;
	if (!dryRun) {
		backupPath = await backupIfExists(configPath, now);
		await writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
		if (!rawOptions.skipPluginUninstall) {
			const result = await (deps.runCommand ?? defaultRunCommand)(openclawBin, [
				"plugins",
				"uninstall",
				MEMX_PLUGIN_ID,
				"--force"
			]);
			if (result.code !== 0) warnings.push(warningForFailedUninstall(result));
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
			allow: Array.isArray(current?.plugins?.allow) ? current.plugins.allow.filter(isMemxId).length : 0
		}
	};
}
async function runCodexUninstall(rawOptions = {}, deps = {}) {
	const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_CODEX_CONFIG_PATH;
	const now = deps.now ?? Date.now;
	const dryRun = Boolean(rawOptions.dryRun);
	const current = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
	const next = applyCodexTomlDisconnect(current);
	let backupPath = null;
	if (!dryRun) {
		backupPath = await backupIfExists(configPath, now);
		await writeAtomic(configPath, next ? `${next}\n` : "");
	}
	return {
		ok: true,
		target: "codex",
		dryRun,
		configPath,
		backupPath,
		removed: current !== next
	};
}
async function runClaudeCodeUninstall(rawOptions = {}, deps = {}) {
	const configPath = trimOrUndefined(rawOptions.configPath) ?? DEFAULT_CLAUDE_CONFIG_PATH;
	const now = deps.now ?? Date.now;
	const dryRun = Boolean(rawOptions.dryRun);
	const current = existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : {};
	const next = applyClaudeJsonDisconnect(current);
	let backupPath = null;
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
		removed: Boolean(current?.mcpServers && typeof current.mcpServers === "object" && !Array.isArray(current.mcpServers) && current.mcpServers.memx)
	};
}
//#endregion
export { applyOpenClawUninstallConfig, runClaudeCodeUninstall, runCodexUninstall, runOpenClawUninstall };
