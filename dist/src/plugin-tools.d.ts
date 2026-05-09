import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import { type MemxRuntimeManager } from "./runtime.js";
import type { MemoryPluginConfig, MemxLogger } from "./types.js";
type ToolContext = {
    agentId?: string;
    sessionKey?: string;
    workspaceDir?: string;
};
export declare function createMemxTools(params: {
    toolCtx: ToolContext;
    config: MemoryPluginConfig;
    manager: MemxRuntimeManager;
    logger: MemxLogger;
}): AnyAgentTool[] | null;
export {};
