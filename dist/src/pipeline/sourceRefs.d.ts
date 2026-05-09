import type { EvidenceUnitRole, NormalizedSourceRef } from "../types.js";
export declare function normalizeSourceRef(ref: unknown): NormalizedSourceRef | null;
export declare function normalizeSourceRefs(refs: unknown): NormalizedSourceRef[];
export declare function sourceRefRaws(refs: unknown): string[];
export declare function promptLineRole(line: string): EvidenceUnitRole | "unknown";
export declare function isAnswerPromptLineRole(role: EvidenceUnitRole | "unknown"): boolean;
