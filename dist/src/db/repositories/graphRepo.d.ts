import type { GraphEvidence, EntityIdentityLinkType, EntityMention, NormalizedEntity, NormalizedGraphEdge } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class GraphRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    upsertEntity(entity: NormalizedEntity): void;
    findEntityByName(name: string, entityType?: string): NormalizedEntity | null;
    lookupEntityByName(name: string, preferredType?: string): NormalizedEntity | null;
    getEntityById(entityId: string): NormalizedEntity | null;
    lookupEntityByNormalizedName(normalizedName: string, preferredType?: string): NormalizedEntity | null;
    lookupEntityByAlias(normalizedAlias: string, preferredType?: string): NormalizedEntity | null;
    searchEntitiesByQuery(query: string, limit?: number): NormalizedEntity[];
    listResolvedMentionsByNormalized(params: {
        agentId: string;
        scope: string;
        normalizedText: string;
        sessionKey?: string;
        limit?: number;
    }): EntityMention[];
    upsertEntityMention(mention: EntityMention): void;
    upsertEntityAliasSource(params: {
        entityId: string;
        aliasText: string;
        sourceRef: string;
        confidence: number;
        createdAt: string;
        metadataJson?: Record<string, unknown>;
    }): void;
    upsertIdentityLink(params: {
        srcEntityId: string;
        dstEntityId: string;
        linkType: EntityIdentityLinkType;
        confidence: number;
        evidenceRef: string;
        status?: "active" | "rejected";
        at: string;
        metadataJson?: Record<string, unknown>;
    }): void;
    linkedEntityIds(params: {
        entityId: string;
        linkTypes?: EntityIdentityLinkType[];
        status?: "active" | "rejected";
        limit?: number;
    }): string[];
    findSupersedingEntity(entityId: string): NormalizedEntity | null;
    listMentionsForEntity(params: {
        entityId: string;
        limit?: number;
    }): EntityMention[];
    listAliasSourcesForEntity(params: {
        entityId: string;
        limit?: number;
    }): Array<{
        aliasText: string;
        normalizedAlias: string;
        sourceRef: string;
        confidence: number;
        createdAt: string;
        metadataJson: Record<string, unknown>;
    }>;
    upsertEdge(edge: NormalizedGraphEdge): {
        action: "created" | "merged";
    };
    closeActiveSlotEdges(params: {
        agentId: string;
        scope: string;
        srcEntityId: string;
        relType: string;
        relationSlot: string;
        validTo: string;
    }): number;
    expandNeighborhood(params: {
        agentId: string;
        scopes: string[];
        seedEntityIds: string[];
        maxHops: number;
        maxEdges: number;
        maxNodes: number;
        now?: string;
        readEpoch?: number;
    }): GraphEvidence;
    pruneLowConfidence(params: {
        agentId: string;
        olderThan: string;
        maxConfidence: number;
    }): number;
    private toEntity;
    private toEntityMention;
}
