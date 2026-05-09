import type { MemxStoreBundle } from "../runtime.js";
import type { MemoryOperationContext, TurnCaptureMessage } from "../types.js";
import type { MemxLogger } from "../types.js";
export declare class MemxTurnScheduler {
    private readonly store;
    private readonly logger;
    private chain;
    constructor(store: MemxStoreBundle, logger: MemxLogger);
    enqueue(ctx: MemoryOperationContext, messages: TurnCaptureMessage[]): Promise<void>;
    flush(): Promise<void>;
    private maybePromoteTaskOutcome;
    private closeTask;
    private reopenTask;
    private processTurn;
    /** Process a single message: chunk creation, dedup, candidate extraction, policy eval, write. */
    private processMessage;
    /** Summarize the task and promote outcome after all messages are processed. */
    private summarizeAndUpdateTask;
}
