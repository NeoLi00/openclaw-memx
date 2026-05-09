import type { ConversationChunk } from "../types.js";
export type AssistantChunkAssessment = {
    weight: number;
    grounding: number;
    complexity: number;
    useSummaryOnly: boolean;
};
export declare function contentStructuralComplexity(text: string): number;
export declare function assessAssistantChunk(chunk: ConversationChunk, taskChunks: ConversationChunk[]): AssistantChunkAssessment;
export declare function renderTaskPromptChunk(chunk: ConversationChunk, taskChunks: ConversationChunk[]): string;
export declare function filteredGroundedTaskChunks(chunks: ConversationChunk[]): ConversationChunk[];
export declare function assistantVectorText(chunk: ConversationChunk, taskChunks?: ConversationChunk[]): string;
export declare function assistantVectorSummary(chunk: ConversationChunk, taskChunks?: ConversationChunk[]): string;
export declare function isProjectNameMatch(name: string, projectCode: string | undefined): boolean;
