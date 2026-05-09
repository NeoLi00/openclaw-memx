import { MemxDbClient } from "./db/client.js";
import { AbstractionRepo } from "./db/repositories/abstractionRepo.js";
import { AuditRepo } from "./db/repositories/auditRepo.js";
import { BeliefRepo } from "./db/repositories/beliefRepo.js";
import { ChunkRepo } from "./db/repositories/chunkRepo.js";
import { EventRepo } from "./db/repositories/eventRepo.js";
import { FactRepo } from "./db/repositories/factRepo.js";
import { GraphRepo } from "./db/repositories/graphRepo.js";
import { MaintenanceRepo } from "./db/repositories/maintenanceRepo.js";
import { SourceSegmentRepo } from "./db/repositories/sourceSegmentRepo.js";
import { StateRepo } from "./db/repositories/stateRepo.js";
import { StrategyRepo } from "./db/repositories/strategyRepo.js";
import { TaskRepo } from "./db/repositories/taskRepo.js";
import { VectorRepo } from "./db/repositories/vectorRepo.js";
import { MemxReasoner } from "./pipeline/reasoner.js";
import { MemxTurnScheduler } from "./pipeline/turnScheduler.js";
import { OptionalEmbeddingBackend } from "./search/backends/embeddingBackend.js";
import type { MemoryOperationContext, MemoryPluginConfig, MemxLogger, PluginActorContext } from "./types.js";
export type MemxStoreBundle = {
    client: MemxDbClient;
    stateRepo: StateRepo;
    taskRepo: TaskRepo;
    chunkRepo: ChunkRepo;
    factRepo: FactRepo;
    eventRepo: EventRepo;
    graphRepo: GraphRepo;
    sourceSegmentRepo: SourceSegmentRepo;
    vectorRepo: VectorRepo;
    auditRepo: AuditRepo;
    maintenanceRepo: MaintenanceRepo;
    beliefRepo: BeliefRepo;
    abstractionRepo: AbstractionRepo;
    strategyRepo: StrategyRepo;
    retrievalBackend: OptionalEmbeddingBackend;
    reasoner: MemxReasoner;
    turnScheduler: MemxTurnScheduler;
};
export declare function resolveDbPath(config: MemoryPluginConfig, actor: PluginActorContext): string | null;
export declare function buildOperationContext(config: MemoryPluginConfig, actor: PluginActorContext, overrides?: {
    now?: string;
}): MemoryOperationContext | null;
export declare class MemxRuntimeManager {
    private readonly logger;
    private readonly stores;
    private readonly sessionCursors;
    private readonly lastRecall;
    private readonly maintenanceTimers;
    private readonly maintenanceContexts;
    private readonly maintenanceLoops;
    private readonly maintenanceLeaseOwner;
    constructor(logger: MemxLogger);
    getStore(ctx: MemoryOperationContext): Promise<MemxStoreBundle>;
    closeAll(): Promise<void>;
    flushAll(): Promise<void>;
    getSessionCursor(agentId: string, sessionKey: string): number | undefined;
    setSessionCursor(agentId: string, sessionKey: string, cursor: number): void;
    rememberRecall(agentId: string, sessionKey: string | undefined, payload: {
        chunkIds: string[];
        texts: string[];
    }): void;
    consumeRecall(agentId: string, sessionKey: string | undefined): {
        chunkIds: string[];
        texts: string[];
    };
    recordMaintenanceTurn(ctx: MemoryOperationContext, params: {
        turnId: string;
        observedAt: string;
        store?: MemxStoreBundle;
    }): Promise<void>;
    private startMaintenanceLoop;
    private scheduleIdleFlush;
    private clearMaintenanceTimer;
    private buildMaintenanceContext;
    private runMaintenanceLoop;
    private flushPendingMaintenance;
    private createStore;
}
