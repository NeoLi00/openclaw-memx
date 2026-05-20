//#region src/host/uninstall.d.ts
type OpenClawConfigLike = {
  plugins?: {
    allow?: string[];
    slots?: Record<string, string>;
    entries?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type UninstallCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};
type UninstallDeps = {
  now?: () => number;
  runCommand?: (command: string, args: string[]) => Promise<UninstallCommandResult>;
};
type OpenClawUninstallOptions = {
  configPath?: string;
  openclawBin?: string;
  skipPluginUninstall?: boolean;
  dryRun?: boolean;
};
type StandaloneUninstallOptions = {
  configPath?: string;
  homeDir?: string;
  codexBin?: string;
  claudeBin?: string;
  codexMarketplaceDir?: string;
  claudeMarketplaceDir?: string;
  dryRun?: boolean;
};
declare function applyOpenClawUninstallConfig(input: unknown): OpenClawConfigLike;
declare function runOpenClawUninstall(rawOptions?: OpenClawUninstallOptions, deps?: UninstallDeps): Promise<Record<string, unknown>>;
declare function runCodexUninstall(rawOptions?: StandaloneUninstallOptions, deps?: Pick<UninstallDeps, "now" | "runCommand">): Promise<Record<string, unknown>>;
declare function runClaudeCodeUninstall(rawOptions?: StandaloneUninstallOptions, deps?: Pick<UninstallDeps, "now" | "runCommand">): Promise<Record<string, unknown>>;
//#endregion
export { OpenClawUninstallOptions, StandaloneUninstallOptions, UninstallCommandResult, UninstallDeps, applyOpenClawUninstallConfig, runClaudeCodeUninstall, runCodexUninstall, runOpenClawUninstall };