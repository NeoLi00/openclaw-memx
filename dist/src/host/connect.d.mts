//#region src/host/connect.d.ts
type GenericMcpConfig = {
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
declare function buildGenericMcpConfig(url?: string, secret?: string): GenericMcpConfig;
declare function hasCodexMemxBlock(toml: string): boolean;
declare function applyCodexTomlConnect(toml: string, url?: string, secret?: string): string;
declare function applyClaudeJsonConnect(input: unknown, url?: string, secret?: string): Record<string, unknown>;
declare function connectCodexConfig(configPath?: string, url?: string, secret?: string): string;
declare function connectClaudeCodeConfig(configPath?: string, url?: string, secret?: string): string;
//#endregion
export { GenericMcpConfig, applyClaudeJsonConnect, applyCodexTomlConnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock };