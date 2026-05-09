import type { GraphEvidenceEdge, GraphEvidenceNode, GraphPathCandidate } from "../types.js";
export declare function buildGraphPathCandidates(params: {
    seedNodeIds: string[];
    prioritySeedNodeIds?: string[];
    nodes: ReadonlyMap<string, GraphEvidenceNode>;
    edges: GraphEvidenceEdge[];
    now: string;
    maxPaths: number;
    maxHops: number;
}): GraphPathCandidate[];
