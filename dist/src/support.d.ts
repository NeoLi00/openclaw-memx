export declare function nowIso(date?: Date): string;
export declare function randomId(prefix: string): string;
export declare function stableHash(parts: Array<string | undefined | null>): string;
export declare function normalizeText(text: string): string;
export declare function normalizedTerms(text: string, params?: {
    stopwords?: Set<string>;
    minLength?: number;
    includeCjkSubwords?: boolean;
}): string[];
export declare function truncateText(text: string, maxChars: number): string;
export declare function ensureParentDir(filePath: string): Promise<void>;
export declare function resolveUserPath(input: string): string;
export declare function safeJsonParse<T>(value: string | null | undefined, fallback: T): T;
export declare function clamp01(value: number): number;
export declare function normalizeName(value: string): string;
export declare function escapeSqlLike(value: string): string;
export declare function addHours(iso: string, hours: number): string;
export declare function cosineSimilarity(left: number[], right: number[]): number;
export declare function orderByScore<T extends {
    score: number;
}>(items: T[]): T[];
/**
 * Validates that a string is a reasonable entity name rather than a sentence fragment.
 * Rejects overly long strings, sentence-like structures, and strings lacking
 * any alphabetic or CJK content.
 */
export declare function isValidEntityName(name: string): boolean;
export declare function objectRecord(value: unknown): Record<string, unknown> | undefined;
