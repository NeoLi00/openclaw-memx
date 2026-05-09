import type { MemxStoreBundle } from "../runtime.js";
import type { MemoryOperationContext, NormalizedEntity, VectorDocRecord } from "../types.js";
export declare const ENTITY_PROFILE_DOC_TYPE = "entity_profile";
export declare function buildEntityProfileText(params: {
    entity: NormalizedEntity;
    aliases: string[];
    supportSnippets: string[];
    relationSummaries: string[];
}): string;
export declare function buildEntityProfileDoc(store: MemxStoreBundle, ctx: MemoryOperationContext, entity: NormalizedEntity): VectorDocRecord;
export declare function refreshEntityProfileDocs(store: MemxStoreBundle, ctx: MemoryOperationContext, entityIds: string[]): void;
