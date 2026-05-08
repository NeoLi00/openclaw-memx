import type {
  MemoryCallProvenance,
  MemoryLlmBudgetAudit,
  MemoryLlmBudgetCall,
  MemoryLlmCallStage,
} from "../types.js";

export function createMemoryLlmBudgetAudit(): MemoryLlmBudgetAudit {
  return {
    calls: [],
    hotPathLlmCallCount: 0,
    writeHotPathLlmCallCount: 0,
    queryHotPathLlmCallCount: 0,
    postAnswerWritebackLlmCallCount: 0,
    maintenanceLlmCallCount: 0,
  };
}

function countsAsLlm(provenance: MemoryCallProvenance): boolean {
  return provenance === "llm" || provenance === "hybrid";
}

export function recordMemoryLlmBudgetCall(
  audit: MemoryLlmBudgetAudit | undefined,
  entry: Omit<MemoryLlmBudgetCall, "at"> & { at?: string },
): void {
  if (!audit) {
    return;
  }
  const call: MemoryLlmBudgetCall = {
    ...entry,
    at: entry.at ?? new Date().toISOString(),
  };
  audit.calls.push(call);
  if (!countsAsLlm(call.provenance)) {
    return;
  }
  if (call.stage === "query_hot_path" || call.stage === "write_hot_path") {
    audit.hotPathLlmCallCount += 1;
  }
  switch (call.stage) {
    case "write_hot_path":
      audit.writeHotPathLlmCallCount += 1;
      break;
    case "query_hot_path":
      audit.queryHotPathLlmCallCount += 1;
      break;
    case "post_answer_writeback":
      audit.postAnswerWritebackLlmCallCount += 1;
      break;
    case "maintenance_async":
      audit.maintenanceLlmCallCount += 1;
      break;
  }
}

export function snapshotMemoryLlmBudgetAudit(
  audit: MemoryLlmBudgetAudit | undefined,
): MemoryLlmBudgetAudit | undefined {
  if (!audit) {
    return undefined;
  }
  return {
    calls: audit.calls.map((entry) => ({ ...entry })),
    hotPathLlmCallCount: audit.hotPathLlmCallCount,
    writeHotPathLlmCallCount: audit.writeHotPathLlmCallCount,
    queryHotPathLlmCallCount: audit.queryHotPathLlmCallCount,
    postAnswerWritebackLlmCallCount: audit.postAnswerWritebackLlmCallCount,
    maintenanceLlmCallCount: audit.maintenanceLlmCallCount,
  };
}

export function inferWriteLlmStage(role: "user" | "assistant" | "tool"): MemoryLlmCallStage {
  return role === "assistant" ? "post_answer_writeback" : "write_hot_path";
}
