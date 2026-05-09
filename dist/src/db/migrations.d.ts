export type DbMigration = {
    version: number;
    description: string;
    sql: string;
};
export declare const MEMX_MIGRATIONS: DbMigration[];
