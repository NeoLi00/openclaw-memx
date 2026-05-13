import type { RouteDecision } from "../types.js";
import type { MemxReasoner } from "./reasoner.js";

export async function routeQuery(
  query: string,
  options?: { reasoner?: MemxReasoner },
): Promise<RouteDecision> {
  if (options?.reasoner) {
    const llmResult = await options.reasoner.judgeQueryRouteWithLlm(query);
    if (llmResult) {
      return llmResult;
    }
  }
  return {
    routeType: "unknown",
    routeConfidence: 0,
    reasons: ["llm-only route unavailable"],
  };
}
