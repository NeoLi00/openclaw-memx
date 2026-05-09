import type { MemoryLlmBudgetAudit, MemoryLlmBudgetCall, MemoryLlmCallStage } from "../types.js";
export declare function createMemoryLlmBudgetAudit(): MemoryLlmBudgetAudit;
export declare function recordMemoryLlmBudgetCall(audit: MemoryLlmBudgetAudit | undefined, entry: Omit<MemoryLlmBudgetCall, "at"> & {
    at?: string;
}): void;
export declare function snapshotMemoryLlmBudgetAudit(audit: MemoryLlmBudgetAudit | undefined): MemoryLlmBudgetAudit | undefined;
export declare function inferWriteLlmStage(role: "user" | "assistant" | "tool"): MemoryLlmCallStage;
