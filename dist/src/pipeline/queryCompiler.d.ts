import type { MemoryOperationContext, QueryCompileResult } from "../types.js";
type QueryCompilerReasoner = {
    isEnabled?: () => boolean;
    compileQuerySemantics?: (query: string, fallback: QueryCompileResult) => Promise<Partial<QueryCompileResult> | null>;
};
type QueryCompileParams = {
    query: string;
    ctx: MemoryOperationContext;
    backgroundMinimalContext?: string[];
    activeTaskTitle?: string;
    recentTaskTitles?: string[];
    reasoner?: QueryCompilerReasoner;
};
export declare function compileQueryDeterministically(query: string): QueryCompileResult;
export declare function compileQuery(params: QueryCompileParams): Promise<QueryCompileResult>;
export {};
