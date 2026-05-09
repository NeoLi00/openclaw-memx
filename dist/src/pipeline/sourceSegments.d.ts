import type { ConversationChunk, SourceSegmentRecord, VectorDocRecord } from "../types.js";
export declare const SOURCE_SEGMENT_TARGET_CHARS = 1800;
export declare const SOURCE_SEGMENT_OVERLAP_CHARS = 220;
export declare function splitSourceText(text: string, params?: {
    targetChars?: number;
    overlapChars?: number;
}): Array<{
    index: number;
    start: number;
    end: number;
    text: string;
}>;
export declare function sourceGroupIdForChunk(chunk: ConversationChunk): string;
export declare function buildSourceSegmentsForChunk(chunk: ConversationChunk): SourceSegmentRecord[];
export declare function buildSourceSegmentVectorDocs(params: {
    chunk: ConversationChunk;
    segments: SourceSegmentRecord[];
}): VectorDocRecord[];
