import type { MemxStoreBundle } from "../runtime.js";
import type { MaintenanceBatchMetadata, MemoryOperationContext } from "../types.js";
export declare function runAutomaticMaintenanceBatch(store: MemxStoreBundle, ctx: MemoryOperationContext, batch: MaintenanceBatchMetadata): Promise<void>;
