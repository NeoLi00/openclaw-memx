import type { MemoryPluginConfig, ScopeVars } from "../types.js";
export declare function renderTemplate(input: string, vars: ScopeVars): string;
export declare function resolveDefaultScope(config: MemoryPluginConfig, vars: ScopeVars): string;
export declare function resolveAllowedScopes(config: MemoryPluginConfig, vars: ScopeVars): string[];
export declare function isScopeAllowed(scope: string, config: MemoryPluginConfig, vars: ScopeVars): boolean;
export declare function defaultRetrievalScopes(config: MemoryPluginConfig, vars: ScopeVars): string[];
