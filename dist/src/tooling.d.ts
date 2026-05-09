export declare function stringEnum<T extends readonly string[]>(values: T, description?: string): any;
export declare function jsonToolResult(payload: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    details: unknown;
};
export declare function readString(params: Record<string, unknown>, key: string): string | undefined;
export declare function readNumber(params: Record<string, unknown>, key: string): number | undefined;
export declare function readBoolean(params: Record<string, unknown>, key: string): boolean | undefined;
