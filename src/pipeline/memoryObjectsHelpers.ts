import { containsLikelySecret, looksLikePromptInjection } from "../security/injection.js";
import type { EvidenceRow, LineageRef, SearchHit } from "../types.js";
import { isBootstrapMemoryContamination } from "./bootstrapFilter.js";
import { canonicalStateKey } from "./semantics.js";

export function splitLabelValue(text: string): { label: string; value: string } {
  const separator = text.indexOf(":");
  if (separator < 0) {
    return { label: text.trim(), value: "" };
  }
  return {
    label: text.slice(0, separator).trim(),
    value: text.slice(separator + 1).trim(),
  };
}

export function toEvidenceRow(params: {
  id: string;
  text: string;
  score: number;
  scope: string;
  confidence?: number;
  sourceRef?: string;
  observedAt?: string;
  provenance?: string;
  lineage?: LineageRef;
}): EvidenceRow {
  return {
    id: params.id,
    text: params.text,
    score: params.score,
    scope: params.scope,
    confidence: params.confidence,
    sourceRef: params.sourceRef,
    observedAt: params.observedAt,
    provenance: params.provenance,
    lineage: params.lineage,
  };
}

function asLineageSourceKind(value: unknown): LineageRef["sourceKind"] | undefined {
  switch (value) {
    case "chunk":
    case "task":
    case "state":
    case "fact":
    case "event":
    case "entity_alias":
    case "graph_edge":
    case "vector_doc":
    case "alternate":
      return value;
    default:
      return undefined;
  }
}

function asCanonicalKind(value: unknown): LineageRef["canonicalKind"] | undefined {
  switch (value) {
    case "state":
    case "fact":
    case "event":
    case "entity":
    case "graph_edge":
    case "task":
    case "chunk":
      return value;
    default:
      return undefined;
  }
}

export function normalizeLineageRef(value: unknown): LineageRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const sourceKind = asLineageSourceKind(record.sourceKind);
  const sourceId = typeof record.sourceId === "string" && record.sourceId.trim() ? record.sourceId.trim() : undefined;
  if (!sourceKind || !sourceId) {
    return undefined;
  }
  return {
    sourceKind,
    sourceId,
    ...(typeof record.sourceRef === "string" && record.sourceRef.trim()
      ? { sourceRef: record.sourceRef.trim() }
      : {}),
    ...(asCanonicalKind(record.canonicalKind) && typeof record.canonicalId === "string" && record.canonicalId.trim()
      ? {
          canonicalKind: asCanonicalKind(record.canonicalKind),
          canonicalId: record.canonicalId.trim(),
        }
      : {}),
    ...(typeof record.materializedEpoch === "number" && Number.isFinite(record.materializedEpoch)
      ? { materializedEpoch: Math.trunc(record.materializedEpoch) }
      : {}),
  };
}

export function lineageFromMetadata(
  metadata: Record<string, unknown> | undefined,
  fallback?: Partial<LineageRef>,
): LineageRef | undefined {
  const direct = normalizeLineageRef(metadata?.lineage);
  if (direct) {
    return direct;
  }
  const sourceKind = asLineageSourceKind(metadata?.sourceKind) ?? fallback?.sourceKind;
  const sourceId =
    (typeof metadata?.sourceId === "string" && metadata.sourceId.trim()
      ? metadata.sourceId.trim()
      : undefined) ?? fallback?.sourceId;
  if (!sourceKind || !sourceId) {
    return undefined;
  }
  return {
    sourceKind,
    sourceId,
    ...(typeof metadata?.sourceRef === "string" && metadata.sourceRef.trim()
      ? { sourceRef: metadata.sourceRef.trim() }
      : fallback?.sourceRef
        ? { sourceRef: fallback.sourceRef }
        : {}),
    ...(asCanonicalKind(metadata?.canonicalKind) &&
    typeof metadata?.canonicalId === "string" &&
    metadata.canonicalId.trim()
      ? {
          canonicalKind: asCanonicalKind(metadata?.canonicalKind),
          canonicalId: metadata.canonicalId.trim(),
        }
      : fallback?.canonicalKind && fallback?.canonicalId
        ? {
            canonicalKind: fallback.canonicalKind,
            canonicalId: fallback.canonicalId,
          }
        : {}),
    ...(typeof metadata?.materializedEpoch === "number" && Number.isFinite(metadata.materializedEpoch)
      ? { materializedEpoch: Math.trunc(metadata.materializedEpoch) }
      : typeof fallback?.materializedEpoch === "number"
        ? { materializedEpoch: fallback.materializedEpoch }
        : {}),
  };
}

export function lineageMetadata(lineage: LineageRef): Record<string, unknown> {
  return {
    sourceKind: lineage.sourceKind,
    sourceId: lineage.sourceId,
    ...(lineage.sourceRef ? { sourceRef: lineage.sourceRef } : {}),
    ...(lineage.canonicalKind && lineage.canonicalId
      ? {
          canonicalKind: lineage.canonicalKind,
          canonicalId: lineage.canonicalId,
        }
      : {}),
    ...(typeof lineage.materializedEpoch === "number"
      ? { materializedEpoch: lineage.materializedEpoch }
      : {}),
    lineage,
  };
}

export function dedupeEvidenceRows(rows: EvidenceRow[], limit: number): EvidenceRow[] {
  const seen = new Set<string>();
  const result: EvidenceRow[] = [];
  for (const row of rows) {
    const key = row.text.trim().toLowerCase() || row.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

export function normalizeSearchText(text: string): string {
  return text.replace(/^(user|assistant|tool):\s*/i, "").trim();
}

export function shouldSuppressRecallText(text: string): boolean {
  const normalized = normalizeSearchText(text);
  return (
    isBootstrapMemoryContamination(normalized) ||
    looksLikePromptInjection(normalized) ||
    containsLikelySecret(normalized)
  );
}

export function rowsFromSearchHits(hits: SearchHit[]): EvidenceRow[] {
  return hits.map((hit) =>
    toEvidenceRow({
      id: hit.docId,
      text: normalizeSearchText(hit.text),
      score: hit.score,
      scope: typeof hit.metadata.scope === "string" ? hit.metadata.scope : "unknown",
      confidence: typeof hit.metadata.confidence === "number" ? hit.metadata.confidence : undefined,
      observedAt: typeof hit.metadata.observedAt === "string" ? hit.metadata.observedAt : undefined,
      provenance:
        typeof hit.metadata.role === "string"
          ? hit.metadata.role
          : typeof hit.metadata.sourceKind === "string"
            ? hit.metadata.sourceKind
            : undefined,
      lineage: lineageFromMetadata(hit.metadata, {
        sourceKind: "vector_doc",
        sourceId: hit.docId,
      }),
    }),
  );
}

function humanizePredicate(predicate: string): string {
  if (predicate.startsWith("prefers_")) {
    return "prefers";
  }
  return predicate.replaceAll("_", " ");
}

function humanizeFactObject(predicate: string, object?: string): string {
  if (!object) {
    return "";
  }
  if (predicate === "prefers_output_order") {
    return object.replace(/\b(zh|en) first(?:,)? (zh|en) second\b/i, "$1 first, $2 second");
  }
  return object;
}

export function describeStateValue(key: string, valueJson: Record<string, unknown>): string {
  const detailValue = (value: unknown): string => {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => detailValue(entry))
        .filter(Boolean)
        .join(", ");
    }
    if (value && typeof value === "object") {
      return JSON.stringify(value);
    }
    return "";
  };
  const formatStateDetailEntries = (
    omittedKeys: string[],
    preferredKeys: string[],
    extrasOnly = false,
  ): string[] => {
    const omitted = new Set(omittedKeys);
    const seen = new Set<string>();
    const details: string[] = [];
    const pushKey = (entryKey: string): void => {
      if (seen.has(entryKey) || omitted.has(entryKey)) {
        return;
      }
      seen.add(entryKey);
      const rendered = detailValue(valueJson[entryKey]);
      if (!rendered) {
        return;
      }
      details.push(`${entryKey}=${rendered}`);
    };
    for (const entryKey of preferredKeys) {
      pushKey(entryKey);
    }
    for (const entryKey of Object.keys(valueJson).sort()) {
      pushKey(entryKey);
    }
    if (!extrasOnly && details.length === 0) {
      const fallback = detailValue(valueJson);
      return fallback ? [fallback] : [];
    }
    return details;
  };
  if (key.startsWith("project.") && canonicalStateKey(key) !== "project.active_project") {
    const projectCode =
      typeof valueJson.projectCode === "string" && valueJson.projectCode.trim()
        ? valueJson.projectCode.trim()
        : key.slice("project.".length).trim();
    const version = typeof valueJson.version === "string" ? valueJson.version.trim() : "";
    const launchDate = typeof valueJson.launchDate === "string" ? valueJson.launchDate.trim() : "";
    const internalTrialDate =
      typeof valueJson.internalTrialDate === "string" ? valueJson.internalTrialDate.trim() : "";
    const historicalAliases = Array.isArray(valueJson.historicalAliases)
      ? valueJson.historicalAliases
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(", ")
      : typeof valueJson.historicalAliases === "string"
        ? valueJson.historicalAliases.trim()
        : "";
    const components =
      valueJson.components &&
      typeof valueJson.components === "object" &&
      !Array.isArray(valueJson.components)
        ? Object.entries(valueJson.components as Record<string, unknown>)
            .map(([slot, value]) =>
              typeof value === "string" && value.trim() ? `${slot}=${value.trim()}` : "",
            )
            .filter(Boolean)
            .join(", ")
        : "";
    const details = [
      projectCode,
      version ? `v${version}` : "",
      launchDate ? `launch ${launchDate}` : "",
      internalTrialDate ? `internal ${internalTrialDate}` : "",
      historicalAliases ? `historical aliases=${historicalAliases}` : "",
      components,
      ...formatStateDetailEntries(
        ["projectCode", "version", "launchDate", "internalTrialDate", "historicalAliases", "components"],
        ["status", "note", "decision"],
        true,
      ),
    ].filter(Boolean);
    return details.join(" | ");
  }
  const project = typeof valueJson.project === "string" ? valueJson.project : undefined;
  const task = typeof valueJson.task === "string" ? valueJson.task : undefined;
  const step = typeof valueJson.step === "string" ? valueJson.step : undefined;
  const blocker = typeof valueJson.blocker === "string" ? valueJson.blocker : undefined;
  const genericValue = typeof valueJson.value === "string" ? valueJson.value : undefined;
  switch (canonicalStateKey(key)) {
    case "project.active_project":
      return [project ?? genericValue ?? "", ...formatStateDetailEntries(["project", "value"], ["status", "note"], true)]
        .filter(Boolean)
        .join(" | ");
    case "workflow.current_task":
      return [
        task ?? genericValue ?? "",
        ...formatStateDetailEntries(
          ["task", "value"],
          ["status", "note", "decision", "topic", "option"],
          true,
        ),
      ]
        .filter(Boolean)
        .join(" | ");
    case "workflow.next_action":
      return [step ?? genericValue ?? "", ...formatStateDetailEntries(["step", "value"], ["status", "note", "reason"], true)]
        .filter(Boolean)
        .join(" | ");
    case "workflow.blocker":
      return [
        blocker ?? genericValue ?? "",
        ...formatStateDetailEntries(["blocker", "value"], ["status", "note", "resolution"], true),
      ]
        .filter(Boolean)
        .join(" | ");
    default:
      return formatStateDetailEntries(["value"], ["topic", "option", "decision", "status", "note"]).join(
        " | ",
      );
  }
}

export function formatFactLine(params: {
  subject: string;
  predicate: string;
  object?: string;
  objectValueJson?: Record<string, unknown>;
  status?: string;
}): string {
  const value = params.object
    ? humanizeFactObject(params.predicate, params.object)
    : JSON.stringify(params.objectValueJson ?? {});
  const prefix =
    params.status === "superseded"
      ? "[previous] "
      : params.status === "uncertain"
        ? "[uncertain] "
        : "";
  return `${prefix}${params.subject} ${humanizePredicate(params.predicate)} ${value}`.trim();
}
