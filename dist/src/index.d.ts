import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk/core";
import type { EvidenceBundle } from "./types.js";
export declare function evidencePlanRuleLines(bundle: EvidenceBundle): string[];
export declare function createMemoryMemxPlugin(): OpenClawPluginDefinition;
declare const memoryMemxPlugin: OpenClawPluginDefinition;
export default memoryMemxPlugin;
