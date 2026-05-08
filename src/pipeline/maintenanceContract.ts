import { objectRecord } from "../support.js";
import type { MaintenanceAuthoritySource, MaintenanceSemanticSource } from "../types.js";

export const MAINTENANCE_CONTRACT_VERSION = "memx-maintenance-contract-v1";

export type MaintenanceRecallLayer =
  | "fact"
  | "state"
  | "event"
  | "graph"
  | "strategy"
  | "abstraction"
  | "belief"
  | "control";

export function uniqueMaintenanceRefs(values: Array<string | undefined | null>): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  ];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function mergeStringArrays(
  existing: Record<string, unknown> | undefined,
  key: string,
  next: string[],
): string[] {
  return uniqueMaintenanceRefs([...stringArray(existing?.[key]), ...next]);
}

export function sourceRefsFromMaintenanceMetadata(
  metadata: Record<string, unknown> | undefined,
): string[] {
  if (!metadata) {
    return [];
  }
  const promotion = objectRecord(metadata.promotion);
  const contract = objectRecord(metadata.maintenanceContract);
  return uniqueMaintenanceRefs([
    ...stringArray(metadata.sourceRefsForExpansion),
    ...stringArray(metadata.sourceRefs),
    ...stringArray(metadata.supportRefs),
    ...stringArray(metadata.supportContentRefs),
    ...stringArray(contract?.sourceRefsForExpansion),
    ...stringArray(contract?.supportContentRefs),
    ...stringArray(contract?.supportRefs),
    ...stringArray(promotion?.sourceRefsForExpansion),
    ...stringArray(promotion?.supportContentRefs),
    ...stringArray(promotion?.supportRefs),
    typeof metadata.sourceRef === "string" ? metadata.sourceRef : undefined,
    typeof contract?.sourceRef === "string" ? contract.sourceRef : undefined,
    typeof promotion?.sourceRef === "string" ? promotion.sourceRef : undefined,
  ]);
}

export function summarizeMaintenanceContractDiagnostics(
  metadataEntries: Array<Record<string, unknown> | undefined>,
): {
  outputCount: number;
  outputsWithLineage: number;
  sourceRefCount: number;
  supportContentRefCount: number;
  derivedFromIdCount: number;
  recallVisibleCount: number;
  answerEligibleByDefaultCount: number;
  recallLayers: Record<string, number>;
  sourceRefsForExpansion: string[];
} {
  const recallLayers = new Map<string, number>();
  const sourceRefsForExpansion: string[] = [];
  let outputsWithLineage = 0;
  let sourceRefCount = 0;
  let supportContentRefCount = 0;
  let derivedFromIdCount = 0;
  let recallVisibleCount = 0;
  let answerEligibleByDefaultCount = 0;

  for (const metadata of metadataEntries) {
    if (!metadata) {
      continue;
    }
    const contract = objectRecord(metadata.maintenanceContract);
    const expansionRefs = uniqueMaintenanceRefs([
      ...stringArray(metadata.sourceRefsForExpansion),
      ...stringArray(contract?.sourceRefsForExpansion),
      ...sourceRefsFromMaintenanceMetadata(metadata),
    ]);
    const supportContentRefs = uniqueMaintenanceRefs([
      ...stringArray(metadata.supportContentRefs),
      ...stringArray(contract?.supportContentRefs),
    ]);
    const derivedFromIds = uniqueMaintenanceRefs([
      ...stringArray(metadata.derivedFromIds),
      ...stringArray(contract?.derivedFromIds),
    ]);
    const sourceRef =
      (typeof metadata.sourceRef === "string" && metadata.sourceRef.trim()) ||
      (typeof contract?.sourceRef === "string" && contract.sourceRef.trim()) ||
      undefined;
    const recallLayer =
      (typeof metadata.recallLayer === "string" && metadata.recallLayer.trim()) ||
      (typeof contract?.recallLayer === "string" && contract.recallLayer.trim()) ||
      undefined;
    const recallVisible =
      metadata.recallVisible === true ||
      contract?.recallVisible === true ||
      expansionRefs.length > 0;
    const answerEligible =
      metadata.answerEligibleByDefault === true || contract?.answerEligibleByDefault === true;

    if (sourceRef) {
      sourceRefCount += 1;
    }
    supportContentRefCount += supportContentRefs.length;
    derivedFromIdCount += derivedFromIds.length;
    if (expansionRefs.length > 0 || sourceRef || supportContentRefs.length > 0) {
      outputsWithLineage += 1;
    }
    if (recallVisible) {
      recallVisibleCount += 1;
    }
    if (answerEligible) {
      answerEligibleByDefaultCount += 1;
    }
    if (recallLayer) {
      recallLayers.set(recallLayer, (recallLayers.get(recallLayer) ?? 0) + 1);
    }
    sourceRefsForExpansion.push(...expansionRefs);
  }

  return {
    outputCount: metadataEntries.length,
    outputsWithLineage,
    sourceRefCount,
    supportContentRefCount,
    derivedFromIdCount,
    recallVisibleCount,
    answerEligibleByDefaultCount,
    recallLayers: Object.fromEntries(recallLayers.entries()),
    sourceRefsForExpansion: uniqueMaintenanceRefs(sourceRefsForExpansion),
  };
}

export function buildMaintenanceContractMetadata(params: {
  existing?: Record<string, unknown>;
  sourceRef?: string;
  supportContentRefs?: string[];
  supportRefs?: string[];
  supportBeliefIds?: string[];
  derivedFromIds?: string[];
  semanticSource: MaintenanceSemanticSource;
  semanticSources?: MaintenanceSemanticSource[];
  authoritySource: MaintenanceAuthoritySource;
  generatedFrom: string | string[];
  recallLayer: MaintenanceRecallLayer;
  answerEligibleByDefault: boolean;
  recallVisible?: boolean;
  materializedEpoch?: number;
  derivationPolicyVersion?: string;
}): Record<string, unknown> {
  const existing = params.existing ?? {};
  const supportContentRefs = mergeStringArrays(existing, "supportContentRefs", [
    ...(params.supportContentRefs ?? []),
    ...(params.sourceRef ? [params.sourceRef] : []),
  ]);
  const supportRefs = mergeStringArrays(existing, "supportRefs", [
    ...(params.supportRefs ?? []),
    ...supportContentRefs,
  ]);
  const supportBeliefIds = mergeStringArrays(
    existing,
    "supportBeliefIds",
    params.supportBeliefIds ?? [],
  );
  const derivedFromIds = mergeStringArrays(existing, "derivedFromIds", params.derivedFromIds ?? []);
  const semanticSources = uniqueMaintenanceRefs([
    params.semanticSource,
    ...(params.semanticSources ?? []),
  ]) as MaintenanceSemanticSource[];
  const generatedFrom = Array.isArray(params.generatedFrom)
    ? uniqueMaintenanceRefs(params.generatedFrom)
    : params.generatedFrom;
  const sourceRefsForExpansion = uniqueMaintenanceRefs([
    ...supportContentRefs,
    ...supportRefs,
    ...(params.sourceRef ? [params.sourceRef] : []),
  ]);
  const recallVisible = params.recallVisible ?? sourceRefsForExpansion.length > 0;
  const sourceRef =
    params.sourceRef ??
    (typeof existing.sourceRef === "string" && existing.sourceRef.trim()
      ? existing.sourceRef.trim()
      : sourceRefsForExpansion[0]);
  const materializedEpoch =
    typeof params.materializedEpoch === "number" && Number.isFinite(params.materializedEpoch)
      ? Math.trunc(params.materializedEpoch)
      : typeof existing.materializedEpoch === "number" &&
          Number.isFinite(existing.materializedEpoch)
        ? Math.trunc(existing.materializedEpoch)
        : undefined;
  const derivationPolicyVersion =
    params.derivationPolicyVersion ??
    (typeof existing.derivationPolicyVersion === "string" && existing.derivationPolicyVersion.trim()
      ? existing.derivationPolicyVersion.trim()
      : MAINTENANCE_CONTRACT_VERSION);

  return {
    ...existing,
    ...(sourceRef ? { sourceRef } : {}),
    supportContentRefs,
    supportRefs,
    supportBeliefIds,
    derivedFromIds,
    semanticSource: params.semanticSource,
    semanticSources,
    authoritySource: params.authoritySource,
    generatedFrom,
    maintenanceContractVersion: MAINTENANCE_CONTRACT_VERSION,
    recallVisible,
    recallLayer: params.recallLayer,
    sourceRefsForExpansion,
    answerEligibleByDefault: params.answerEligibleByDefault,
    ...(materializedEpoch !== undefined ? { materializedEpoch } : {}),
    derivationPolicyVersion,
    maintenanceContract: {
      version: MAINTENANCE_CONTRACT_VERSION,
      ...(sourceRef ? { sourceRef } : {}),
      supportContentRefs,
      supportRefs,
      supportBeliefIds,
      derivedFromIds,
      recallVisible,
      recallLayer: params.recallLayer,
      sourceRefsForExpansion,
      answerEligibleByDefault: params.answerEligibleByDefault,
      semanticSource: params.semanticSource,
      semanticSources,
      authoritySource: params.authoritySource,
      generatedFrom,
      ...(materializedEpoch !== undefined ? { materializedEpoch } : {}),
      derivationPolicyVersion,
    },
  };
}
