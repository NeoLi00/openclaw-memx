import type { MemoryPiiMode } from "../types.js";
export declare function redactSensitiveText(text: string, piiMode: MemoryPiiMode): string;
export declare function containsSensitiveValue(text: string): boolean;
export declare function sensitivityScore(text: string): number;
