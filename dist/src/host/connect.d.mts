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
declare function buildGenericMcpConfig(): GenericMcpConfig;
declare function hasCodexMemxBlock(toml: string): boolean;
declare function applyCodexTomlConnect(toml: string, url?: string): string;
declare function applyClaudeJsonConnect(input: unknown): Record<string, unknown>;
declare function connectCodexConfig(configPath?: string): string;
declare function connectClaudeCodeConfig(configPath?: string): string;
//#endregion
export { GenericMcpConfig, applyClaudeJsonConnect, applyCodexTomlConnect, buildGenericMcpConfig, connectClaudeCodeConfig, connectCodexConfig, hasCodexMemxBlock };