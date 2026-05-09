import type { MaintenanceRunRecord, MemoryPolicyDecision, MemorySignalEventRecord, RetrievalAuditRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class AuditRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    recordPolicyDecision(params: {
        agentId: string;
        sourceRef: string;
        candidateText: string;
        decision: MemoryPolicyDecision;
        createdAt: string;
        metadataJson?: Record<string, unknown>;
    }): void;
    recordRetrieval(audit: RetrievalAuditRecord): void;
    recordSignal(signal: MemorySignalEventRecord): void;
    listSignals(params: {
        agentId: string;
        sessionKey?: string;
        signalTypes?: MemorySignalEventRecord["signalType"][];
        after?: string;
        until?: string;
        limit?: number;
    }): MemorySignalEventRecord[];
    listSignalsForTargets(params: {
        agentId: string;
        targets: Array<{
            memoryKind: MemorySignalEventRecord["memoryKind"];
            contentRef?: string;
            semanticKey: string;
        }>;
        until?: string;
    }): MemorySignalEventRecord[];
    latestSignalCreatedAt(params: {
        agentId: string;
        sessionKey?: string;
    }): string | undefined;
    startMaintenance(params: {
        agentId: string;
        jobType: string;
        stats: Record<string, unknown>;
        startedAt: string;
    }): string;
    finishMaintenance(run: MaintenanceRunRecord): void;
}
