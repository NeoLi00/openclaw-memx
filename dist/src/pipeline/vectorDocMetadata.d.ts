import type { LineageRef } from "../types.js";
export declare function buildVectorDocMetadata(params: {
    docType: string;
    confidence: number;
    observedAt: string;
    lineage: LineageRef;
    extra?: Record<string, unknown>;
}): Record<string, unknown>;
