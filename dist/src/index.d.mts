import { EvidenceBundle } from "./types.mjs";
import { OpenClawPluginDefinition } from "openclaw/plugin-sdk/core";

//#region src/index.d.ts
declare function evidencePlanRuleLines(bundle: EvidenceBundle): string[];
declare function createMemoryMemxPlugin(): OpenClawPluginDefinition;
declare const memoryMemxPlugin: OpenClawPluginDefinition;
//#endregion
export { createMemoryMemxPlugin, evidencePlanRuleLines, memoryMemxPlugin };