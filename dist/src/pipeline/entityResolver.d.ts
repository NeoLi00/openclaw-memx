import type { MemxStoreBundle } from "../runtime.js";
import type { EntityDisambiguationDecision, EntityMention, EntityMentionSemanticRole, EntityResolutionCandidate, EntityResolutionResult, EntityType, MemoryOperationContext } from "../types.js";
type BuildEntityMentionParams = {
    ctx: MemoryOperationContext;
    scope: string;
    rawText: string;
    proposedType?: EntityType;
    semanticRole: EntityMentionSemanticRole;
    sourceRef: string;
    supportText: string;
    observedAt: string;
    sessionKey?: string;
    turnIndex?: number;
    metadataJson?: Record<string, unknown>;
};
type ResolveOptions = {
    persist?: boolean;
    createIfMissing?: boolean;
    disambiguate?: (input: {
        mention: EntityMention;
        candidates: EntityResolutionCandidate[];
    }) => EntityDisambiguationDecision | null;
};
export declare function buildEntityMention(params: BuildEntityMentionParams): EntityMention;
export declare function resolveEntityMention(store: MemxStoreBundle, ctx: MemoryOperationContext, mention: EntityMention, options?: ResolveOptions): EntityResolutionResult;
export declare function resolveEntityMentions(store: MemxStoreBundle, ctx: MemoryOperationContext, mentions: EntityMention[], options?: ResolveOptions): EntityResolutionResult[];
export {};
