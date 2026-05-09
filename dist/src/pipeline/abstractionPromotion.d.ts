import type { MemxStoreBundle } from "../runtime.js";
import type { AbstractionPromotionStats, MaintenanceBatchMetadata, MemoryOperationContext } from "../types.js";
export declare function runAbstractionPromotion(store: MemxStoreBundle, ctx: MemoryOperationContext, options?: {
    batch?: MaintenanceBatchMetadata;
    candidateIds?: string[];
    deltaTriggered?: boolean;
}): AbstractionPromotionStats;
