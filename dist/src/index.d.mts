import { GenericMcpConfig, applyClaudeJsonConnect, applyCodexTomlConnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock } from "./host/connect.mjs";
import { MemxHostId, MemxHostMessage, MemxTurnEnvelope, normalizeHookPayload, normalizeObservePayload } from "./host/hookPayload.mjs";
import { MEMX_MCP_TOOLS, MemxMcpHandlerDeps, MemxMcpProxy, defaultMemxProxy, handleMcpRequest } from "./host/mcpProtocol.mjs";
import { EvidenceBundle } from "./types.mjs";
import { MemxHostService, MemxRecallRequest, MemxServiceOptions, createServiceConfigFromEnv, stableHostTurnId } from "./host/service.mjs";
import { OpenClawPluginDefinition } from "openclaw/plugin-sdk/core";

//#region src/index.d.ts
declare function evidencePlanRuleLines(bundle: EvidenceBundle): string[];
declare function extractPromptQuery(event: {
  prompt?: string;
  messages?: unknown[];
}): string;
declare function createMemoryMemxPlugin(): OpenClawPluginDefinition;
declare const memoryMemxPlugin: OpenClawPluginDefinition;
//#endregion
export { createMemoryMemxPlugin, evidencePlanRuleLines, extractPromptQuery, memoryMemxPlugin };