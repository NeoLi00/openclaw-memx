import { MEMX_NPM_PACKAGE } from "../identity.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region src/host/connect.ts
const PACKAGE_SPEC = MEMX_NPM_PACKAGE;
const DEFAULT_URL = "http://localhost:3878";
const CODEX_SECTION = "[mcp_servers.memx]";
const CODEX_ENV_SECTION = "[mcp_servers.memx.env]";
function buildGenericMcpConfig(url = "${MEMX_URL}", secret = "${MEMX_SECRET}") {
	return { mcpServers: { memx: {
		command: "npx",
		args: [
			"-y",
			"-p",
			PACKAGE_SPEC,
			"memx-mcp"
		],
		env: {
			MEMX_URL: url,
			MEMX_SECRET: secret
		}
	} } };
}
function hasCodexMemxBlock(toml) {
	return toml.includes(CODEX_SECTION);
}
function stripCodexMemxBlock(toml) {
	const out = [];
	let skipping = false;
	for (const line of toml.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (trimmed === CODEX_SECTION || trimmed === CODEX_ENV_SECTION) {
			skipping = true;
			continue;
		}
		if (skipping && trimmed.startsWith("[") && trimmed !== CODEX_ENV_SECTION) skipping = false;
		if (!skipping) out.push(line);
	}
	return out.join("\n").replace(/\n{3,}$/u, "\n\n").trimEnd();
}
function applyCodexTomlDisconnect(toml) {
	return stripCodexMemxBlock(toml);
}
function applyCodexTomlConnect(toml, url = DEFAULT_URL, secret = "${MEMX_SECRET}") {
	const cleaned = stripCodexMemxBlock(toml);
	const block = [
		CODEX_SECTION,
		"command = \"npx\"",
		`args = ["-y", "-p", "${PACKAGE_SPEC}", "memx-mcp"]`,
		"",
		CODEX_ENV_SECTION,
		`MEMX_URL = "${url}"`,
		`MEMX_SECRET = "${secret}"`,
		""
	].join("\n");
	return `${cleaned}${cleaned ? "\n\n" : ""}${block}`;
}
function applyClaudeJsonConnect(input, url = "${MEMX_URL}", secret = "${MEMX_SECRET}") {
	const base = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
	const currentServers = base.mcpServers && typeof base.mcpServers === "object" && !Array.isArray(base.mcpServers) ? base.mcpServers : {};
	return {
		...base,
		mcpServers: {
			...currentServers,
			memx: buildGenericMcpConfig(url, secret).mcpServers.memx
		}
	};
}
function applyClaudeJsonDisconnect(input) {
	const base = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
	const currentServers = base.mcpServers && typeof base.mcpServers === "object" && !Array.isArray(base.mcpServers) ? { ...base.mcpServers } : {};
	delete currentServers.memx;
	return {
		...base,
		mcpServers: currentServers
	};
}
function writeAtomic(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, path);
}
function connectCodexConfig(configPath = join(homedir(), ".codex", "config.toml"), url = DEFAULT_URL, secret = "${MEMX_SECRET}") {
	writeAtomic(configPath, applyCodexTomlConnect(existsSync(configPath) ? readFileSync(configPath, "utf8") : "", url, secret));
	return configPath;
}
function connectClaudeCodeConfig(configPath = join(homedir(), ".claude.json"), url = "${MEMX_URL}", secret = "${MEMX_SECRET}") {
	const next = applyClaudeJsonConnect(existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {}, url, secret);
	writeAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`);
	return configPath;
}
//#endregion
export { applyClaudeJsonConnect, applyClaudeJsonDisconnect, applyCodexTomlConnect, applyCodexTomlDisconnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock };
