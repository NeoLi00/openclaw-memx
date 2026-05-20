//#region src/host/connect.d.ts
type McpCommandConfig = {
  command: string;
  args: string[];
};
type GenericMcpConfig = {
  mcpServers: {
    memx: {
      command: string;
      args: string[];
      env: {
        MEMX_URL: string;
        MEMX_SECRET: string;
      };
    };
  };
};
declare function buildGenericMcpConfig(url?: string, secret?: string, commandConfig?: McpCommandConfig): GenericMcpConfig;
declare function hasCodexMemxBlock(toml: string): boolean;
declare function applyCodexTomlDisconnect(toml: string): string;
declare function applyCodexTomlConnect(toml: string, url?: string, secret?: string, commandConfig?: McpCommandConfig): string;
declare function applyClaudeJsonConnect(input: unknown, url?: string, secret?: string, commandConfig?: McpCommandConfig): Record<string, unknown>;
declare function applyClaudeJsonDisconnect(input: unknown): Record<string, unknown>;
declare function connectCodexConfig(configPath?: string, url?: string, secret?: string): string;
declare function connectClaudeCodeConfig(configPath?: string, url?: string, secret?: string): string;
//#endregion
export { GenericMcpConfig, McpCommandConfig, applyClaudeJsonConnect, applyClaudeJsonDisconnect, applyCodexTomlConnect, applyCodexTomlDisconnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock };