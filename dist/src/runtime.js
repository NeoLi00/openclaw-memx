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
import { createMemoryLlmBudgetAudit } from "./pipeline/llmBudgetAudit.js";
import { runAutomaticMaintenanceBatch } from "./pipeline/maintenanceBatch.js";
import { MemxReasoner } from "./pipeline/reasoner.js";
import { MemxTurnScheduler } from "./pipeline/turnScheduler.js";
import { OptionalEmbeddingBackend } from "./search/backends/embeddingBackend.js";
import { defaultRetrievalScopes, renderTemplate } from "./security/scopes.js";
import { nowIso, randomId, resolveUserPath } from "./support.js";
function storeKey(agentId, dbPath) {
    return `${agentId}:${dbPath}`;
}
function maintenanceKey(agentId, dbPath, sessionKey) {
    return `${agentId}:${dbPath}:${sessionKey}`;
}
export function resolveDbPath(config, actor) {
    if (!actor.agentId) {
        return null;
    }
    const rendered = renderTemplate(config.dbPath, {
        agentId: actor.agentId,
        sessionKey: actor.sessionKey,
        project: actor.project,
        workspace: actor.workspaceDir,
    });
    return resolveUserPath(rendered);
}
export function buildOperationContext(config, actor, overrides) {
    if (!actor.agentId) {
        return null;
    }
    const dbPath = resolveDbPath(config, actor);
    if (!dbPath) {
        return null;
    }
    return {
        agentId: actor.agentId,
        sessionKey: actor.sessionKey,
        workspaceDir: actor.workspaceDir,
        project: actor.project,
        runId: actor.runId,
        channelId: actor.channelId,
        config,
        dbPath,
        scopes: defaultRetrievalScopes(config, {
            agentId: actor.agentId,
            sessionKey: actor.sessionKey,
            project: actor.project,
            workspace: actor.workspaceDir,
        }),
        now: overrides?.now ?? nowIso(),
        llmBudgetAudit: createMemoryLlmBudgetAudit(),
    };
}
export class MemxRuntimeManager {
    logger;
    stores = new Map();
    sessionCursors = new Map();
    lastRecall = new Map();
    maintenanceTimers = new Map();
    maintenanceContexts = new Map();
    maintenanceLoops = new Map();
    maintenanceLeaseOwner = randomId("maintenance-runtime");
    constructor(logger) {
        this.logger = logger;
    }
    async getStore(ctx) {
        const key = storeKey(ctx.agentId, ctx.dbPath);
        const existing = this.stores.get(key);
        if (existing) {
            return existing;
        }
        const created = this.createStore(ctx);
        this.stores.set(key, created);
        // Evict the cached promise if creation fails so a subsequent call can retry.
        created.catch(() => {
            this.stores.delete(key);
        });
        return created;
    }
    async closeAll() {
        await this.flushAll();
        await this.flushPendingMaintenance("shutdown");
        for (const timer of this.maintenanceTimers.values()) {
            clearTimeout(timer);
        }
        this.maintenanceTimers.clear();
        for (const entry of this.stores.values()) {
            const store = await entry;
            try {
                await store.retrievalBackend.close?.();
            }
            catch (error) {
                this.logger.warn(`memory-memx: retrieval backend close failed (${String(error)})`);
            }
            finally {
                store.client.close();
            }
        }
        this.stores.clear();
        this.sessionCursors.clear();
        this.lastRecall.clear();
        this.maintenanceContexts.clear();
        this.maintenanceLoops.clear();
    }
    async flushAll() {
        for (const entry of this.stores.values()) {
            const store = await entry;
            await store.turnScheduler.flush();
            await store.retrievalBackend.flushPendingUpserts?.();
        }
    }
    getSessionCursor(agentId, sessionKey) {
        return this.sessionCursors.get(`${agentId}:${sessionKey}`);
    }
    setSessionCursor(agentId, sessionKey, cursor) {
        this.sessionCursors.set(`${agentId}:${sessionKey}`, cursor);
    }
    rememberRecall(agentId, sessionKey, payload) {
        if (!sessionKey) {
            return;
        }
        this.lastRecall.set(`${agentId}:${sessionKey}`, payload);
    }
    consumeRecall(agentId, sessionKey) {
        if (!sessionKey) {
            return { chunkIds: [], texts: [] };
        }
        const key = `${agentId}:${sessionKey}`;
        const payload = this.lastRecall.get(key) ?? { chunkIds: [], texts: [] };
        this.lastRecall.delete(key);
        return payload;
    }
    async recordMaintenanceTurn(ctx, params) {
        if (!ctx.config.advanced.enableMaintenanceJobs) {
            return;
        }
        const sessionKey = ctx.sessionKey ?? "default";
        const store = params.store ?? (await this.getStore(ctx));
        const key = maintenanceKey(ctx.agentId, ctx.dbPath, sessionKey);
        this.maintenanceContexts.set(key, { ...ctx, sessionKey });
        const state = store.maintenanceRepo.recordPendingTurn({
            agentId: ctx.agentId,
            sessionKey,
            turnId: params.turnId,
            observedAt: params.observedAt,
            updatedAt: ctx.now,
        });
        const threshold = ctx.config.advanced.maintenanceTriggerMode === "per_turn"
            ? 1
            : Math.max(1, ctx.config.advanced.maintenanceBatchTurns);
        if (state.pendingTurnCount >= threshold) {
            this.clearMaintenanceTimer(key);
            this.startMaintenanceLoop(store, ctx, "threshold");
            return;
        }
        if (ctx.config.advanced.maintenanceTriggerMode === "batched" &&
            ctx.config.advanced.maintenanceIdleFlushMinutes > 0) {
            this.scheduleIdleFlush(store, ctx);
        }
    }
    startMaintenanceLoop(store, template, reason) {
        const sessionKey = template.sessionKey ?? "default";
        const key = maintenanceKey(template.agentId, template.dbPath, sessionKey);
        const existing = this.maintenanceLoops.get(key);
        if (existing) {
            return;
        }
        const loop = this.runMaintenanceLoop(store, template, reason).finally(() => {
            this.maintenanceLoops.delete(key);
        });
        this.maintenanceLoops.set(key, loop);
        loop.catch((error) => {
            this.logger.warn?.(`memory-memx: maintenance batch loop failed (${String(error)})`);
        });
    }
    scheduleIdleFlush(store, template) {
        const sessionKey = template.sessionKey ?? "default";
        const key = maintenanceKey(template.agentId, template.dbPath, sessionKey);
        this.clearMaintenanceTimer(key);
        const delayMs = Math.max(0.001, template.config.advanced.maintenanceIdleFlushMinutes) * 60_000;
        const timer = setTimeout(() => {
            this.maintenanceTimers.delete(key);
            this.startMaintenanceLoop(store, template, "idle");
        }, delayMs);
        this.maintenanceTimers.set(key, timer);
    }
    clearMaintenanceTimer(key) {
        const existing = this.maintenanceTimers.get(key);
        if (!existing) {
            return;
        }
        clearTimeout(existing);
        this.maintenanceTimers.delete(key);
    }
    buildMaintenanceContext(template) {
        return {
            ...template,
            now: nowIso(),
            llmBudgetAudit: createMemoryLlmBudgetAudit(),
        };
    }
    async runMaintenanceLoop(store, template, initialReason) {
        const sessionKey = template.sessionKey ?? "default";
        const key = maintenanceKey(template.agentId, template.dbPath, sessionKey);
        let reason = initialReason;
        const threshold = template.config.advanced.maintenanceTriggerMode === "per_turn"
            ? 1
            : Math.max(1, template.config.advanced.maintenanceBatchTurns);
        while (true) {
            const state = store.maintenanceRepo.getState(template.agentId, sessionKey);
            const pendingTurnCount = state?.pendingTurnCount ?? 0;
            const shouldClaim = reason === "shutdown"
                ? pendingTurnCount > 0
                : reason === "idle"
                    ? pendingTurnCount > 0
                    : pendingTurnCount >= threshold;
            if (!shouldClaim) {
                if (pendingTurnCount > 0 &&
                    template.config.advanced.maintenanceTriggerMode === "batched" &&
                    template.config.advanced.maintenanceIdleFlushMinutes > 0) {
                    this.scheduleIdleFlush(store, template);
                }
                return;
            }
            const claim = store.maintenanceRepo.claimBatch({
                agentId: template.agentId,
                sessionKey,
                reason,
                leaseOwner: this.maintenanceLeaseOwner,
                leaseTtlMs: 5 * 60_000,
                now: nowIso(),
            });
            if (!claim) {
                return;
            }
            this.clearMaintenanceTimer(key);
            const upperWatermarks = {
                event: store.eventRepo.latestObservedAt({
                    agentId: template.agentId,
                    scopes: template.scopes,
                    sessionKey,
                }),
                signal: store.auditRepo.latestSignalCreatedAt({
                    agentId: template.agentId,
                    sessionKey,
                }),
                task: store.taskRepo.latestUpdatedAt({
                    agentId: template.agentId,
                    scopes: template.scopes,
                    sessionKey,
                }),
            };
            let success = false;
            try {
                await runAutomaticMaintenanceBatch(store, this.buildMaintenanceContext(template), {
                    sessionKey,
                    turnIds: claim.turnIds,
                    turnCount: claim.turnCount,
                    reason: claim.reason,
                    firstObservedAt: claim.firstObservedAt,
                    lastObservedAt: claim.lastObservedAt,
                    lowerWatermarks: claim.lowerWatermarks,
                    upperWatermarks,
                });
                success = true;
            }
            catch (error) {
                this.logger.warn?.(`memory-memx: maintenance batch failed (${String(error)})`);
            }
            finally {
                const nextState = store.maintenanceRepo.finishBatch({
                    agentId: template.agentId,
                    sessionKey,
                    leaseOwner: this.maintenanceLeaseOwner,
                    completedAt: nowIso(),
                    success,
                    ...(success ? { upperWatermarks } : {}),
                });
                if (!success) {
                    if (nextState?.pendingTurnCount &&
                        template.config.advanced.maintenanceTriggerMode === "batched" &&
                        template.config.advanced.maintenanceIdleFlushMinutes > 0) {
                        this.scheduleIdleFlush(store, template);
                    }
                    return;
                }
            }
            const postState = store.maintenanceRepo.getState(template.agentId, sessionKey);
            const postPending = postState?.pendingTurnCount ?? 0;
            if (reason === "shutdown") {
                if (postPending > 0) {
                    reason = "shutdown";
                    continue;
                }
                return;
            }
            if (postPending >= threshold) {
                reason = "threshold";
                continue;
            }
            if (postPending > 0 &&
                template.config.advanced.maintenanceTriggerMode === "batched" &&
                template.config.advanced.maintenanceIdleFlushMinutes > 0) {
                this.scheduleIdleFlush(store, template);
            }
            return;
        }
    }
    async flushPendingMaintenance(reason) {
        const entries = await Promise.all(this.stores.values());
        for (const store of entries) {
            const pendingStates = store.maintenanceRepo.listPendingStates();
            for (const state of pendingStates) {
                const key = maintenanceKey(state.agentId, store.client.dbPath, state.sessionKey);
                const template = this.maintenanceContexts.get(key);
                if (!template) {
                    continue;
                }
                const existing = this.maintenanceLoops.get(key);
                if (existing) {
                    await existing;
                }
                await this.runMaintenanceLoop(store, template, reason);
            }
        }
    }
    async createStore(ctx) {
        const client = await MemxDbClient.open(ctx.dbPath);
        const vectorRepo = new VectorRepo(client);
        const bundle = {
            client,
            stateRepo: new StateRepo(client),
            taskRepo: new TaskRepo(client),
            chunkRepo: new ChunkRepo(client),
            factRepo: new FactRepo(client),
            eventRepo: new EventRepo(client),
            graphRepo: new GraphRepo(client),
            sourceSegmentRepo: new SourceSegmentRepo(client),
            vectorRepo,
            auditRepo: new AuditRepo(client),
            maintenanceRepo: new MaintenanceRepo(client),
            beliefRepo: new BeliefRepo(client),
            abstractionRepo: new AbstractionRepo(client),
            strategyRepo: new StrategyRepo(client),
            retrievalBackend: new OptionalEmbeddingBackend(vectorRepo, ctx.config.embedding, this.logger),
            reasoner: new MemxReasoner(ctx.config, this.logger),
            turnScheduler: undefined,
        };
        bundle.turnScheduler = new MemxTurnScheduler(bundle, this.logger);
        return bundle;
    }
}
