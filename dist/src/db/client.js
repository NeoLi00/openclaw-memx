import { createRequire } from "node:module";
import { ensureParentDir, nowIso } from "../support.js";
import { MEMX_MIGRATIONS } from "./migrations.js";
const require = createRequire(import.meta.url);
export function requireNodeSqlite() {
    try {
        return require("node:sqlite");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`SQLite support is unavailable in this Node runtime. ${message}`, {
            cause: error,
        });
    }
}
export class MemxDbClient {
    dbPath;
    db;
    constructor(dbPath) {
        this.dbPath = dbPath;
        const { DatabaseSync } = requireNodeSqlite();
        this.db = new DatabaseSync(dbPath);
        this.initialize();
    }
    static async open(dbPath) {
        await ensureParentDir(dbPath);
        return new MemxDbClient(dbPath);
    }
    initialize() {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA foreign_keys = ON;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
        this.db.exec("PRAGMA temp_store = MEMORY;");
        this.migrate();
    }
    migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
        const appliedRows = this.db.prepare("SELECT version FROM schema_migrations").all();
        const applied = new Set(appliedRows.map((row) => row.version));
        for (const migration of MEMX_MIGRATIONS) {
            if (applied.has(migration.version)) {
                continue;
            }
            this.withTransaction(() => {
                this.db.exec(migration.sql);
                this.db
                    .prepare("INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)")
                    .run(migration.version, migration.description, nowIso());
            });
        }
    }
    prepare(sql) {
        return this.db.prepare(sql);
    }
    exec(sql) {
        this.db.exec(sql);
    }
    withTransaction(run) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const result = run();
            this.db.exec("COMMIT");
            return result;
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    currentMemoryEpoch(agentId) {
        const row = this.db
            .prepare("SELECT current_epoch FROM memory_epoch_heads WHERE agent_id = ?")
            .get(agentId);
        return Number(row?.current_epoch ?? 0);
    }
    nextMemoryEpoch(agentId, updatedAt = nowIso()) {
        this.db
            .prepare(`INSERT INTO memory_epoch_heads(agent_id, current_epoch, updated_at)
         VALUES (?, 0, ?)
         ON CONFLICT(agent_id) DO NOTHING`)
            .run(agentId, updatedAt);
        this.db
            .prepare(`UPDATE memory_epoch_heads
            SET current_epoch = current_epoch + 1,
                updated_at = ?
          WHERE agent_id = ?`)
            .run(updatedAt, agentId);
        return this.currentMemoryEpoch(agentId);
    }
    close() {
        this.db.close();
    }
}
