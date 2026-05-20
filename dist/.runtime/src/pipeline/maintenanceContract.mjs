import { objectRecord } from "../support.mjs";
//#region src/pipeline/maintenanceContract.ts
const MAINTENANCE_CONTRACT_VERSION = "memx-maintenance-contract-v1";
function uniqueMaintenanceRefs(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}
function stringArray(value) {
	return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
}
function mergeStringArrays(existing, key, next) {
	return uniqueMaintenanceRefs([...stringArray(existing?.[key]), ...next]);
}
function sourceRefsFromMaintenanceMetadata(metadata) {
	if (!metadata) return [];
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
		typeof metadata.sourceRef === "string" ? metadata.sourceRef : void 0,
		typeof contract?.sourceRef === "string" ? contract.sourceRef : void 0,
		typeof promotion?.sourceRef === "string" ? promotion.sourceRef : void 0
	]);
}
function summarizeMaintenanceContractDiagnostics(metadataEntries) {
	const recallLayers = /* @__PURE__ */ new Map();
	const sourceRefsForExpansion = [];
	let outputsWithLineage = 0;
	let sourceRefCount = 0;
	let supportContentRefCount = 0;
	let derivedFromIdCount = 0;
	let recallVisibleCount = 0;
	let answerEligibleByDefaultCount = 0;
	for (const metadata of metadataEntries) {
		if (!metadata) continue;
		const contract = objectRecord(metadata.maintenanceContract);
		const expansionRefs = uniqueMaintenanceRefs([
			...stringArray(metadata.sourceRefsForExpansion),
			...stringArray(contract?.sourceRefsForExpansion),
			...sourceRefsFromMaintenanceMetadata(metadata)
		]);
		const supportContentRefs = uniqueMaintenanceRefs([...stringArray(metadata.supportContentRefs), ...stringArray(contract?.supportContentRefs)]);
		const derivedFromIds = uniqueMaintenanceRefs([...stringArray(metadata.derivedFromIds), ...stringArray(contract?.derivedFromIds)]);
		const sourceRef = typeof metadata.sourceRef === "string" && metadata.sourceRef.trim() || typeof contract?.sourceRef === "string" && contract.sourceRef.trim() || void 0;
		const recallLayer = typeof metadata.recallLayer === "string" && metadata.recallLayer.trim() || typeof contract?.recallLayer === "string" && contract.recallLayer.trim() || void 0;
		const recallVisible = metadata.recallVisible === true || contract?.recallVisible === true || expansionRefs.length > 0;
		const answerEligible = metadata.answerEligibleByDefault === true || contract?.answerEligibleByDefault === true;
		if (sourceRef) sourceRefCount += 1;
		supportContentRefCount += supportContentRefs.length;
		derivedFromIdCount += derivedFromIds.length;
		if (expansionRefs.length > 0 || sourceRef || supportContentRefs.length > 0) outputsWithLineage += 1;
		if (recallVisible) recallVisibleCount += 1;
		if (answerEligible) answerEligibleByDefaultCount += 1;
		if (recallLayer) recallLayers.set(recallLayer, (recallLayers.get(recallLayer) ?? 0) + 1);
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
		sourceRefsForExpansion: uniqueMaintenanceRefs(sourceRefsForExpansion)
	};
}
function buildMaintenanceContractMetadata(params) {
	const existing = params.existing ?? {};
	const supportContentRefs = mergeStringArrays(existing, "supportContentRefs", [...params.supportContentRefs ?? [], ...params.sourceRef ? [params.sourceRef] : []]);
	const supportRefs = mergeStringArrays(existing, "supportRefs", [...params.supportRefs ?? [], ...supportContentRefs]);
	const supportBeliefIds = mergeStringArrays(existing, "supportBeliefIds", params.supportBeliefIds ?? []);
	const derivedFromIds = mergeStringArrays(existing, "derivedFromIds", params.derivedFromIds ?? []);
	const semanticSources = uniqueMaintenanceRefs([params.semanticSource, ...params.semanticSources ?? []]);
	const generatedFrom = Array.isArray(params.generatedFrom) ? uniqueMaintenanceRefs(params.generatedFrom) : params.generatedFrom;
	const sourceRefsForExpansion = uniqueMaintenanceRefs([
		...supportContentRefs,
		...supportRefs,
		...params.sourceRef ? [params.sourceRef] : []
	]);
	const recallVisible = params.recallVisible ?? sourceRefsForExpansion.length > 0;
	const sourceRef = params.sourceRef ?? (typeof existing.sourceRef === "string" && existing.sourceRef.trim() ? existing.sourceRef.trim() : sourceRefsForExpansion[0]);
	const materializedEpoch = typeof params.materializedEpoch === "number" && Number.isFinite(params.materializedEpoch) ? Math.trunc(params.materializedEpoch) : typeof existing.materializedEpoch === "number" && Number.isFinite(existing.materializedEpoch) ? Math.trunc(existing.materializedEpoch) : void 0;
	const derivationPolicyVersion = params.derivationPolicyVersion ?? (typeof existing.derivationPolicyVersion === "string" && existing.derivationPolicyVersion.trim() ? existing.derivationPolicyVersion.trim() : "memx-maintenance-contract-v1");
	return {
		...existing,
		...sourceRef ? { sourceRef } : {},
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
		...materializedEpoch !== void 0 ? { materializedEpoch } : {},
		derivationPolicyVersion,
		maintenanceContract: {
			version: MAINTENANCE_CONTRACT_VERSION,
			...sourceRef ? { sourceRef } : {},
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
			...materializedEpoch !== void 0 ? { materializedEpoch } : {},
			derivationPolicyVersion
		}
	};
}
//#endregion
export { buildMaintenanceContractMetadata, sourceRefsFromMaintenanceMetadata, summarizeMaintenanceContractDiagnostics, uniqueMaintenanceRefs };
