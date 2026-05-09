import type { MaintenanceBatchTriggerReason } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export type MaintenanceSchedulerStateRecord = {
    agentId: string;
    sessionKey: string;
    pendingTurnCount: number;
    pendingTurnIds: string[];
    firstPendingObservedAt?: string;
    lastPendingObservedAt?: string;
    inflightTurnCount: number;
    inflightTurnIds: string[];
    inflightReason?: MaintenanceBatchTriggerReason;
    inflightStartedAt?: string;
    inflightFirstObservedAt?: string;
    inflightLastObservedAt?: string;
    lastEventWatermark?: string;
    lastSignalWatermark?: string;
    lastTaskWatermark?: string;
    status: "idle" | "running";
    leaseOwner?: string;
    leaseExpiresAt?: string;
    lastCompletedAt?: string;
    updatedAt: string;
};
export type ClaimedMaintenanceBatch = {
    agentId: string;
    sessionKey: string;
    turnIds: string[];
    turnCount: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    reason: MaintenanceBatchTriggerReason;
    lowerWatermarks: {
        event?: string;
        signal?: string;
        task?: string;
    };
};
export declare class MaintenanceRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    getState(agentId: string, sessionKey: string): MaintenanceSchedulerStateRecord | null;
    listPendingStates(): MaintenanceSchedulerStateRecord[];
    recordPendingTurn(params: {
        agentId: string;
        sessionKey: string;
        turnId: string;
        observedAt: string;
        updatedAt?: string;
    }): MaintenanceSchedulerStateRecord;
    claimBatch(params: {
        agentId: string;
        sessionKey: string;
        reason: MaintenanceBatchTriggerReason;
        leaseOwner: string;
        leaseTtlMs: number;
        now: string;
    }): ClaimedMaintenanceBatch | null;
    finishBatch(params: {
        agentId: string;
        sessionKey: string;
        leaseOwner: string;
        completedAt: string;
        success: boolean;
        upperWatermarks?: {
            event?: string;
            signal?: string;
            task?: string;
        };
    }): MaintenanceSchedulerStateRecord | null;
    private persistRow;
}
