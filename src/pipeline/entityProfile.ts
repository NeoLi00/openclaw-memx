import type { MemxStoreBundle } from "../runtime.js";
import { normalizeText, truncateText } from "../support.js";
import type {
  EntityProfileVectorMetadata,
  MemoryOperationContext,
  NormalizedEntity,
  VectorDocRecord,
} from "../types.js";

export const ENTITY_PROFILE_DOC_TYPE = "entity_profile";

export function buildEntityProfileText(params: {
  entity: NormalizedEntity;
  aliases: string[];
  supportSnippets: string[];
  relationSummaries: string[];
}): string {
  const aliasText = params.aliases.length > 0 ? params.aliases.join(", ") : "none";
  const context = params.supportSnippets.map((snippet) => truncateText(snippet, 180)).join(" ");
  const relations = params.relationSummaries.join("; ");
  return [
    `${params.entity.entityType} entity: ${params.entity.canonicalName}`,
    `Aliases: ${aliasText}`,
    `Type: ${params.entity.entityType}`,
    context ? `Context: ${context}` : "",
    relations ? `Relations: ${relations}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEntityProfileDoc(
  store: MemxStoreBundle,
  ctx: MemoryOperationContext,
  entity: NormalizedEntity,
): VectorDocRecord {
  const aliasSources = store.graphRepo.listAliasSourcesForEntity({
    entityId: entity.entityId,
    limit: 12,
  });
  const mentions = store.graphRepo.listMentionsForEntity({ entityId: entity.entityId, limit: 8 });
  const graph = store.graphRepo.expandNeighborhood({
    agentId: ctx.agentId,
    scopes: ctx.scopes,
    seedEntityIds: [entity.entityId],
    maxHops: 1,
    maxEdges: 8,
    maxNodes: 12,
    now: ctx.now,
    readEpoch: ctx.readEpoch,
  });
  const aliases = [
    ...new Set(
      [...entity.aliases, ...aliasSources.map((entry) => entry.aliasText)].filter(Boolean),
    ),
  ];
  const supportSnippets = [
    ...new Set(mentions.map((mention) => mention.supportText).filter(Boolean)),
  ].slice(0, 5);
  const relationSummaries = graph.edges
    .slice(0, 6)
    .map((edge) => {
      const src =
        graph.nodes.find((node) => node.nodeId === edge.srcNodeId)?.name ?? edge.srcNodeId;
      const dst =
        graph.nodes.find((node) => node.nodeId === edge.dstNodeId)?.name ?? edge.dstNodeId;
      const slot = edge.relationSlot ? `[${edge.relationSlot}]` : "";
      return `${src} ${edge.relType}${slot} ${dst}`;
    })
    .filter(Boolean);
  const supportRefs = [
    ...new Set([
      ...mentions.map((mention) => mention.sourceRef),
      ...aliasSources.map((entry) => entry.sourceRef),
      ...graph.edges
        .map((edge) => edge.evidenceRef)
        .filter((sourceRef): sourceRef is string => Boolean(sourceRef)),
    ]),
  ];
  const relationNeighborIds = [
    ...new Set(
      graph.edges
        .flatMap((edge) => [edge.srcEntityId, edge.dstEntityId])
        .filter(
          (entityId): entityId is string => Boolean(entityId) && entityId !== entity.entityId,
        ),
    ),
  ];
  const metadata: EntityProfileVectorMetadata = {
    canonicalName: entity.canonicalName,
    aliases,
    entityType: entity.entityType,
    supportRefs,
    relationNeighborIds,
    updatedAt: ctx.now,
    confidence: entity.confidence,
  };
  return {
    docId: `entity_profile:${entity.entityId}`,
    docKind: "entity_profile",
    sourceId: entity.entityId,
    scope: ctx.scopes[0] ?? "agent:unknown",
    agentId: ctx.agentId,
    text: buildEntityProfileText({ entity, aliases, supportSnippets, relationSummaries }),
    metadataJson: {
      memxDocType: ENTITY_PROFILE_DOC_TYPE,
      entityId: entity.entityId,
      canonicalKind: "entity",
      canonicalId: entity.entityId,
      sourceKind: ENTITY_PROFILE_DOC_TYPE,
      sourceId: entity.entityId,
      profile: metadata,
      ...metadata,
    },
    createdAt: ctx.now,
    updatedAt: ctx.now,
    materializedEpoch: ctx.readEpoch,
  };
}

export function refreshEntityProfileDocs(
  store: MemxStoreBundle,
  ctx: MemoryOperationContext,
  entityIds: string[],
): void {
  const docs = [...new Set(entityIds)]
    .map((entityId) => store.graphRepo.getEntityById(entityId))
    .filter((entity): entity is NormalizedEntity => Boolean(entity))
    .map((entity) => buildEntityProfileDoc(store, ctx, entity))
    .filter((doc) => normalizeText(doc.text).length > 0);
  if (docs.length > 0) {
    store.retrievalBackend.upsertDocs(docs);
  }
}
