import type { EvidenceRow, LineageRef, SearchHit } from "../types.js";
export declare function splitLabelValue(text: string): {
    label: string;
    value: string;
};
export declare function toEvidenceRow(params: {
    id: string;
    text: string;
    score: number;
    scope: string;
    confidence?: number;
    sourceRef?: string;
    observedAt?: string;
    provenance?: string;
    lineage?: LineageRef;
}): EvidenceRow;
export declare function normalizeLineageRef(value: unknown): LineageRef | undefined;
export declare function lineageFromMetadata(metadata: Record<string, unknown> | undefined, fallback?: Partial<LineageRef>): LineageRef | undefined;
export declare function lineageMetadata(lineage: LineageRef): Record<string, unknown>;
export declare function dedupeEvidenceRows(rows: EvidenceRow[], limit: number): EvidenceRow[];
export declare function normalizeSearchText(text: string): string;
export declare function shouldSuppressRecallText(text: string): boolean;
export declare function rowsFromSearchHits(hits: SearchHit[]): EvidenceRow[];
export declare function describeStateValue(key: string, valueJson: Record<string, unknown>): string;
export declare function formatFactLine(params: {
    subject: string;
    predicate: string;
    object?: string;
    objectValueJson?: Record<string, unknown>;
    status?: string;
}): string;
