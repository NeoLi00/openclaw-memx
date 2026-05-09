import type { DatabaseSync, StatementSync } from "node:sqlite";
export declare function requireNodeSqlite(): typeof import("node:sqlite");
export declare class MemxDbClient {
    readonly dbPath: string;
    readonly db: DatabaseSync;
    constructor(dbPath: string);
    static open(dbPath: string): Promise<MemxDbClient>;
    private initialize;
    private migrate;
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    withTransaction<T>(run: () => T): T;
    currentMemoryEpoch(agentId: string): number;
    nextMemoryEpoch(agentId: string, updatedAt?: string): number;
    close(): void;
}
