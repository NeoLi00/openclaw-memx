import type { RouteDecision } from "../types.js";
import type { MemxReasoner } from "./reasoner.js";
import { judgeQueryRoute } from "./semantics.js";

export async function routeQuery(
  query: string,
  options?: { reasoner?: MemxReasoner },
): Promise<RouteDecision> {
  // LLM-first: try reasoner's LLM route; fall back to heuristic
  if (options?.reasoner) {
    const llmResult = await options.reasoner.judgeQueryRouteWithLlm(query);
    if (llmResult) {
      return llmResult;
    }
  }
  return judgeQueryRoute(query);
}
