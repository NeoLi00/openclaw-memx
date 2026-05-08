import type { EvidenceUnitRole, NormalizedSourceRef, SourceRefKind } from "../types.js";

const PREFIX_KIND: Record<string, SourceRefKind> = {
  turn: "turn",
  user: "turn",
  assistant: "turn",
  tool: "turn",
  system: "turn",
  chunk: "chunk",
  event: "event",
  fact: "fact",
  state: "state",
  edge: "graph_edge",
  graph: "graph_edge",
  graph_edge: "graph_edge",
  entity: "entity",
  belief: "belief",
  strategy: "strategy",
  abstraction: "abstraction_candidate",
  abstraction_candidate: "abstraction_candidate",
  task: "task",
  query: "query",
  prompt_line: "prompt_line",
};

function parseTurnIndex(raw: string): number | undefined {
  const direct = raw.match(/(?:^|[:._-])turn(?:[:._-])?(\d+)(?:[:._-]|$)/iu)?.[1];
  if (direct) {
    const parsed = Number(direct);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const trailing = raw.match(/:(\d+)(?::(?:user|assistant|tool|system))?$/iu)?.[1];
  if (trailing) {
    const parsed = Number(trailing);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parentRefsFor(raw: string, kind: SourceRefKind, id: string): string[] {
  if (raw.startsWith("event:chunk:")) {
    return [`chunk:${raw.slice("event:chunk:".length)}`];
  }
  if (raw.startsWith("fact:chunk:")) {
    return [`chunk:${raw.slice("fact:chunk:".length)}`];
  }
  if (raw.startsWith("state:chunk:")) {
    return [`chunk:${raw.slice("state:chunk:".length)}`];
  }
  if (raw.startsWith("graph_edge:")) {
    return [];
  }
  if (kind === "turn") {
    const roleSuffix = raw.match(/^(.*):(user|assistant|tool|system)$/iu)?.[1];
    return roleSuffix && roleSuffix !== raw ? [roleSuffix] : [];
  }
  if (kind === "event" && id.startsWith("chunk:")) {
    return [`chunk:${id.slice("chunk:".length)}`];
  }
  return [];
}

function sessionKeyFor(raw: string, kind: SourceRefKind): string | undefined {
  if (kind !== "turn") {
    return undefined;
  }
  const parts = raw.split(":");
  if (parts[0] === "user" && parts[1] === "agentmem" && parts.length >= 4) {
    return parts[3];
  }
  if (parts[0] === "agentmem" && parts.length >= 3) {
    return parts[2];
  }
  if (parts[0] === "user" && parts[1] === "lme" && parts.length >= 4) {
    return parts[3];
  }
  if (parts[0] === "lme" && parts.length >= 4) {
    return parts[2];
  }
  const turnIndex = parts.findIndex((part) => /^turn\d+$/iu.test(part));
  if (turnIndex > 0) {
    return parts.slice(0, turnIndex).join(":");
  }
  return undefined;
}

export function normalizeSourceRef(ref: unknown): NormalizedSourceRef | null {
  if (
    ref &&
    typeof ref === "object" &&
    typeof (ref as { raw?: unknown }).raw === "string" &&
    typeof (ref as { kind?: unknown }).kind === "string" &&
    typeof (ref as { id?: unknown }).id === "string"
  ) {
    return ref as NormalizedSourceRef;
  }
  if (typeof ref !== "string") {
    return null;
  }
  const raw = ref.trim();
  if (!raw) {
    return null;
  }
  const prefix = raw.split(":")[0]?.toLowerCase() ?? "";
  const kind =
    PREFIX_KIND[prefix] ??
    (raw.startsWith("lme:") || raw.startsWith("agentmem:") ? "turn" : "turn");
  const id =
    prefix && PREFIX_KIND[prefix] && raw.includes(":") ? raw.slice(prefix.length + 1) : raw;
  return {
    raw,
    kind,
    id,
    sessionKey: sessionKeyFor(raw, kind),
    turnIndex: parseTurnIndex(raw),
    parentRefs: parentRefsFor(raw, kind, id),
  };
}

export function normalizeSourceRefs(refs: unknown): NormalizedSourceRef[] {
  const rawRefs = Array.isArray(refs) ? refs : [refs];
  const normalized = rawRefs
    .map((ref) => normalizeSourceRef(ref))
    .filter((ref): ref is NormalizedSourceRef => Boolean(ref));
  return [...new Map(normalized.map((ref) => [ref.raw, ref])).values()];
}

export function sourceRefRaws(refs: unknown): string[] {
  return normalizeSourceRefs(refs).map((ref) => ref.raw);
}

export function promptLineRole(line: string): EvidenceUnitRole | "unknown" {
  const role = line.trim().match(/^-?\s*\[([a-z_]+)\]/iu)?.[1];
  switch (role) {
    case "answer":
    case "answer_value":
      return "answer_value";
    case "event":
    case "answer_event":
      return "answer_event";
    case "context":
    case "query_context":
      return "query_context";
    case "resource":
    case "user_resource":
      return "user_resource";
    case "prior_advice":
      return "prior_advice";
    case "time_constraint":
      return "time_constraint";
    case "support":
    case "strategy":
    case "belief":
      return "support";
    default:
      return "unknown";
  }
}

export function isAnswerPromptLineRole(role: EvidenceUnitRole | "unknown"): boolean {
  return role === "answer_value" || role === "answer_event" || role === "user_resource";
}
