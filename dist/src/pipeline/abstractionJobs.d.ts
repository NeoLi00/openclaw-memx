import type { MemxStoreBundle } from "../runtime.js";
import type { AbstractionJobStats, MaintenanceBatchMetadata, MemoryOperationContext } from "../types.js";
export declare function runAbstractionJobs(store: MemxStoreBundle, ctx: MemoryOperationContext, options?: {
    refineWithLlm?: boolean;
    batch?: MaintenanceBatchMetadata;
    deltaTriggered?: boolean;
}): Promise<AbstractionJobStats>;
