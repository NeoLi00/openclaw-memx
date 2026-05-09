import type { RouteDecision } from "../types.js";
import type { MemxReasoner } from "./reasoner.js";
export declare function routeQuery(query: string, options?: {
    reasoner?: MemxReasoner;
}): Promise<RouteDecision>;
