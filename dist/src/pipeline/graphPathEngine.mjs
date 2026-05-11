import { clamp01, stableHash } from "../support.mjs";
//#region src/pipeline/graphPathEngine.ts
const GRAPH_STRUCTURAL_RELATION_TYPES = new Set([
	"resolved_by",
	"supported_by",
	"derived_from",
	"contradicts"
]);
const BIDIRECTIONAL_GRAPH_RELATION_TYPES = new Set([
	"contradicts",
	"related_to",
	"targets",
	"resolved_by",
	"supported_by",
	"derived_from",
	"updates"
]);
function graphPathRecencyScore(updatedAt, now) {
	if (!updatedAt) return .42;
	const nowMs = Date.parse(now);
	const updatedMs = Date.parse(updatedAt);
	if (!Number.isFinite(nowMs) || !Number.isFinite(updatedMs)) return .42;
	const ageDays = Math.max(0, (nowMs - updatedMs) / 864e5);
	return clamp01(Math.exp(-ageDays / 21));
}
function graphPathRelationFit(relType) {
	switch (relType) {
		case "resolved_by": return .96;
		case "caused_by": return .92;
		case "depends_on":
		case "blocks": return .9;
		case "supersedes":
		case "contradicts": return .86;
		case "supported_by": return .84;
		case "derived_from": return .8;
		case "updates": return .78;
		case "owner_of":
		case "part_of":
		case "uses":
		case "reads": return .76;
		case "targets": return .68;
		case "related_to": return .58;
	}
}
function graphPathLengthPenalty(edgeCount) {
	if (edgeCount <= 1) return .05;
	if (edgeCount === 2) return .18;
	return clamp01(.18 + (edgeCount - 2) * .14);
}
function graphPathContradictionPenalty(edges) {
	const contradictions = edges.filter((edge) => edge.relType === "contradicts").length;
	return clamp01(contradictions * .45);
}
function graphPathSummary(edges, nodes) {
	return edges.map((edge) => {
		const src = nodes.get(edge.srcNodeId)?.name ?? edge.srcNodeId;
		const dst = nodes.get(edge.dstNodeId)?.name ?? edge.dstNodeId;
		return `${src} --${edge.relationSlot ? `${edge.relType}[${edge.relationSlot}]` : edge.relType}--> ${dst}`;
	}).join(" | ");
}
function buildGraphPathCandidate(params) {
	const uniqueNodeIds = [...new Set(params.nodeIds)];
	const uniqueEdgeIds = [...new Set(params.edges.map((edge) => edge.edgeId))];
	const seedNodeIds = params.prioritySeedNodeIds && params.prioritySeedNodeIds.length > 0 ? params.prioritySeedNodeIds : params.seedNodeIds;
	const entityMatch = clamp01(uniqueNodeIds.filter((nodeId) => seedNodeIds.includes(nodeId)).length / Math.max(1, uniqueNodeIds.length));
	const edgeConfidence = params.edges.reduce((sum, edge) => sum + edge.confidence, 0) / Math.max(1, params.edges.length);
	const recency = params.edges.reduce((sum, edge) => sum + graphPathRecencyScore(edge.updatedAt, params.now), 0) / Math.max(1, params.edges.length);
	const supportDiversity = new Set(params.edges.map((edge) => edge.evidenceRef).filter(Boolean)).size / Math.max(1, params.edges.length);
	const relationFit = params.edges.reduce((sum, edge) => sum + graphPathRelationFit(edge.relType), 0) / Math.max(1, params.edges.length);
	const pathLengthPenalty = graphPathLengthPenalty(params.edges.length);
	const contradictionPenalty = graphPathContradictionPenalty(params.edges);
	const nonEntityNodeRatio = uniqueNodeIds.filter((nodeId) => params.nodes.get(nodeId)?.nodeKind !== "entity").length / Math.max(1, uniqueNodeIds.length);
	const structuralRelationRatio = params.edges.filter((edge) => GRAPH_STRUCTURAL_RELATION_TYPES.has(edge.relType)).length / Math.max(1, params.edges.length);
	const targetEdgeRatio = params.edges.filter((edge) => edge.relType === "targets").length / Math.max(1, params.edges.length);
	const heterogeneousSupport = clamp01(nonEntityNodeRatio * .55 + structuralRelationRatio * .45);
	const hasSynthesizedEdges = params.edges.some((edge) => edge.sourceKind === "synthesized");
	const targetBridgePenalty = clamp01(targetEdgeRatio * (.6 + nonEntityNodeRatio * .4) * Math.max(.25, 1 - structuralRelationRatio * .75));
	const targetOnlyPenalty = hasSynthesizedEdges && structuralRelationRatio === 0 ? .22 : 0;
	const score = clamp01(entityMatch * .24 + edgeConfidence * .28 + recency * .12 + supportDiversity * .14 + relationFit * .22 + heterogeneousSupport * .18 - (targetBridgePenalty * .16 + targetOnlyPenalty * .16 + pathLengthPenalty * .12 + contradictionPenalty * .1));
	return {
		pathId: stableHash([
			"graph-path",
			...uniqueEdgeIds,
			...uniqueNodeIds
		]),
		nodeIds: uniqueNodeIds,
		edgeIds: uniqueEdgeIds,
		features: {
			entityMatch,
			edgeConfidence,
			recency,
			pathLengthPenalty,
			contradictionPenalty,
			supportDiversity,
			relationFit,
			heterogeneousSupport
		},
		score,
		summary: graphPathSummary(params.edges, params.nodes),
		reasons: [
			`entityMatch=${entityMatch.toFixed(2)}`,
			`edgeConfidence=${edgeConfidence.toFixed(2)}`,
			`recency=${recency.toFixed(2)}`,
			`supportDiversity=${supportDiversity.toFixed(2)}`,
			`relationFit=${relationFit.toFixed(2)}`,
			`heterogeneousSupport=${heterogeneousSupport.toFixed(2)}`,
			`targetBridgePenalty=${targetBridgePenalty.toFixed(2)}`,
			`targetOnlyPenalty=${targetOnlyPenalty.toFixed(2)}`,
			`pathLengthPenalty=${pathLengthPenalty.toFixed(2)}`,
			`contradictionPenalty=${contradictionPenalty.toFixed(2)}`
		]
	};
}
function buildGraphPathCandidates(params) {
	if (params.seedNodeIds.length === 0 || params.edges.length === 0 || params.maxPaths <= 0) return [];
	const adjacency = /* @__PURE__ */ new Map();
	for (const edge of params.edges) {
		const srcBucket = adjacency.get(edge.srcNodeId) ?? [];
		srcBucket.push({
			edge,
			nextNodeId: edge.dstNodeId
		});
		adjacency.set(edge.srcNodeId, srcBucket);
		if (BIDIRECTIONAL_GRAPH_RELATION_TYPES.has(edge.relType)) {
			const dstBucket = adjacency.get(edge.dstNodeId) ?? [];
			dstBucket.push({
				edge,
				nextNodeId: edge.srcNodeId
			});
			adjacency.set(edge.dstNodeId, dstBucket);
		}
	}
	const candidates = /* @__PURE__ */ new Map();
	const addCandidate = (nodeIds, edges) => {
		if (edges.length === 0) return;
		const edgeKey = edges.map((edge) => edge.edgeId).join("->");
		if (candidates.has(edgeKey)) return;
		candidates.set(edgeKey, buildGraphPathCandidate({
			nodeIds,
			edges,
			seedNodeIds: params.seedNodeIds,
			prioritySeedNodeIds: params.prioritySeedNodeIds,
			nodes: params.nodes,
			now: params.now
		}));
	};
	const walk = (currentNodeId, pathNodeIds, pathEdges, visitedEdgeIds, depth) => {
		if (depth >= Math.max(1, params.maxHops)) return;
		for (const entry of adjacency.get(currentNodeId) ?? []) {
			const { edge, nextNodeId } = entry;
			if (visitedEdgeIds.has(edge.edgeId)) continue;
			if (pathNodeIds.includes(nextNodeId)) continue;
			const nextEdges = [...pathEdges, edge];
			const nextNodeIds = [...pathNodeIds, nextNodeId];
			addCandidate(nextNodeIds, nextEdges);
			walk(nextNodeId, nextNodeIds, nextEdges, new Set([...visitedEdgeIds, edge.edgeId]), depth + 1);
		}
	};
	for (const seedNodeId of params.seedNodeIds) walk(seedNodeId, [seedNodeId], [], /* @__PURE__ */ new Set(), 0);
	return [...candidates.values()].sort((left, right) => right.score - left.score || right.edgeIds.length - left.edgeIds.length).slice(0, params.maxPaths);
}
//#endregion
export { buildGraphPathCandidates };
