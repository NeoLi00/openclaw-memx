//#region src/host/connect.d.ts
type McpCommandConfig = {
  command: string;
  args: string[];
};
type McpToolsProfile = "full" | "lifecycle-safe" | "none";
type GenericMcpConfig = {
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
declare function buildGenericMcpConfig(url?: string, secret?: string, commandConfig?: McpCommandConfig, mcpTools?: McpToolsProfile): GenericMcpConfig;
declare function hasCodexMemxBlock(toml: string): boolean;
declare function applyCodexTomlDisconnect(toml: string): string;
declare function applyCodexTomlConnect(toml: string, url?: string, secret?: string, commandConfig?: McpCommandConfig, mcpTools?: McpToolsProfile): string;
declare function applyClaudeJsonConnect(input: unknown, url?: string, secret?: string, commandConfig?: McpCommandConfig, mcpTools?: McpToolsProfile): Record<string, unknown>;
declare function applyClaudeJsonDisconnect(input: unknown): Record<string, unknown>;
declare function connectCodexConfig(configPath?: string, url?: string, secret?: string): string;
declare function connectClaudeCodeConfig(configPath?: string, url?: string, secret?: string): string;
//#endregion
export { GenericMcpConfig, McpCommandConfig, McpToolsProfile, applyClaudeJsonConnect, applyClaudeJsonDisconnect, applyCodexTomlConnect, applyCodexTomlDisconnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock };