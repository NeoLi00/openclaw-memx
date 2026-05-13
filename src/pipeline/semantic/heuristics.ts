import { normalizeName, normalizeText, normalizedTerms } from "../../support.js";
import type { GraphRelationType } from "../../types.js";

const EXPLICIT_REMEMBER_PATTERNS = [
  /\bremember this\b/i,
  /\bsave this\b/i,
  /\bnote that\b/i,
  /\bplease remember\b/i,
  /\bdon't forget\b/i,
  /(?:请|帮我)?记住(?:这条|这个|一下)?/u,
  /记一下/u,
  /记下来/u,
  /保存(?:这条|这个)?/u,
  /别忘了/u,
];

const LOW_VALUE_PATTERNS = [
  /^\s*(?:hi|hello|thanks|thank you|ok|okay|sure)\s*[.!?]*\s*$/i,
  /^\s*(?:你好|嗨|谢谢|多谢|好的|好哦|收到|嗯嗯|哈哈+|lol)\s*[。.!！?？]*\s*$/iu,
];

const QUESTION_LIKE_PATTERNS = [
  /^\s*(?:what|why|how|when|where|who|do|does|did|can|could|would|should|is|are|am)\b/i,
  /(?:吗|？|\?|什么|怎么|为何|为什么|谁|哪里|哪儿|如何|是否|有没有|记不记得|还记得)/u,
];

const CHINESE_BIGRAM_STOPWORDS = new Set([
  "什么",
  "怎么",
  "为什么",
  "现在",
  "刚才",
  "之后",
  "以前",
  "之前",
  "当前",
  "上次",
  "最近",
  "哪些",
  "问题",
  "回答",
  "输出",
  "风格",
  "格式",
]);

const STATE_KEY_ALIASES = {
  "project.active_project": ["project.active_project", "active_project"],
  "workflow.current_task": ["workflow.current_task", "current_task"],
  "workflow.current_consideration": [
    "workflow.current_consideration",
    "current_consideration",
    "workflow_candidate_decision",
  ],
  "workflow.next_action": ["workflow.next_action", "workflow_next_step"],
  "workflow.blocker": ["workflow.blocker", "workflow_blocker"],
} as const;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function prototypeSimilarity(
  text: string,
  prototypes: string[],
  stopwords?: Set<string>,
): number {
  const source = tokenizeSearchTerms(text, stopwords ?? new Set());
  if (source.length === 0) {
    return 0;
  }
  let best = 0;
  for (const prototype of prototypes) {
    const target = tokenizeSearchTerms(prototype, stopwords ?? new Set());
    if (target.length === 0) {
      continue;
    }
    let overlap = 0;
    for (const token of source) {
      if (target.includes(token)) {
        overlap += 1;
      }
    }
    best = Math.max(best, overlap / Math.max(Math.min(source.length, target.length), 1));
  }
  return best;
}

export function tokenizeSearchTerms(text: string, stopwords: Set<string>): string[] {
  return normalizedTerms(text, {
    stopwords: new Set([...stopwords, ...CHINESE_BIGRAM_STOPWORDS]),
    minLength: 2,
  });
}

export function hasExplicitRememberIntent(text: string): boolean {
  return matchesAny(text, EXPLICIT_REMEMBER_PATTERNS);
}

const MEMORY_ARTIFACT_PREFIX_PATTERN =
  /^\s*(?:\[(?:answer|context|resource|event|support)\]\s*)?(?:\d{4}-\d{2}-\d{2}\s+conversation_turn:\s*)?(?:(?:\[?user\]?)\s*:?\s*)?(?:reported_detail\s+|observation:\s*)?/iu;

const BARE_MEMORY_USE_INSTRUCTION_PATTERNS = [
  /^(?:that|this|it|the above|the previous(?: answer)?|the last(?: answer)?)\s+(?:is|was|should be)\s+(?:the\s+)?answer\b.{0,120}\b(?:later|if (?:this|it) comes up|when (?:i|we|the user) ask|for later)\b/iu,
  /^(?:remember|save|keep|note|use)\s+(?:this|that|it|the above|the previous(?: answer)?|this answer|that answer)\b.{0,120}\b(?:later|if|when|for)\b/iu,
  /^if\s+(?:asked|this comes up|it comes up)\s+later\b.{0,120}\b(?:answer|use|remember)\b/iu,
  /^(?:这|这个|这条|上面|刚才|前面).{0,16}(?:答案|结论).{0,40}(?:以后|之后|下次|问到|提到|用)/u,
  /^(?:以后|之后|下次).{0,16}(?:问到|提到).{0,16}(?:就用|用).{0,12}(?:这个|这条|上面|刚才|前面)(?:答案|结论)?/u,
];

function stripMemoryArtifactPrefix(text: string): string {
  return text.trim().replace(MEMORY_ARTIFACT_PREFIX_PATTERN, "").trim();
}

export function looksLikeBareMemoryUseInstruction(text: string): boolean {
  const stripped = stripMemoryArtifactPrefix(text);
  if (!stripped) {
    return false;
  }
  if (!matchesAny(stripped, BARE_MEMORY_USE_INSTRUCTION_PATTERNS)) {
    return false;
  }
  // A colon usually introduces the payload ("remember this: the token is ...").
  // Bare instructions only point at nearby evidence and should not become facts.
  if (/[:：]\s*\S{3,}/u.test(stripped)) {
    return false;
  }
  return true;
}

const BARE_INSTRUCTIONAL_GUIDANCE_PATTERNS = [
  /^(?:please\s+)?(?:check|inspect|verify|review|look at|try|run|use|avoid|do not|don't|make sure|keep|call|ask|update)\b/iu,
  /^(?:先|请)?(?:检查|确认|验证|看看|查看|运行|使用|避免|不要|别|先看|先查|记得)\b/u,
];

export function looksLikeBareInstructionalGuidance(text: string): boolean {
  const stripped = stripMemoryArtifactPrefix(text);
  if (!stripped) {
    return false;
  }
  return matchesAny(stripped, BARE_INSTRUCTIONAL_GUIDANCE_PATTERNS);
}

export function isLowValueChatter(text: string): boolean {
  return matchesAny(text, LOW_VALUE_PATTERNS);
}

export function isQuestionLike(text: string): boolean {
  return matchesAny(text.trim(), QUESTION_LIKE_PATTERNS);
}

export function normalizeGraphRelationType(value: string): {
  relationType: GraphRelationType;
  rawPredicate?: string;
} | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "depends_on":
      return { relationType: "depends_on" };
    case "depends":
      return { relationType: "depends_on", rawPredicate: value.trim() };
    case "blocks":
      return { relationType: "blocks" };
    case "blocked_by":
      return { relationType: "blocks", rawPredicate: value.trim() };
    case "caused_by":
      return { relationType: "caused_by" };
    case "because_of":
      return { relationType: "caused_by", rawPredicate: value.trim() };
    case "uses":
      return { relationType: "uses" };
    case "reads":
    case "reads_from":
      return { relationType: "uses", rawPredicate: value.trim() };
    case "part_of":
      return { relationType: "part_of" };
    case "owner_of":
      return { relationType: "owner_of" };
    case "owned_by":
      return { relationType: "owner_of", rawPredicate: value.trim() };
    case "supersedes":
      return { relationType: "supersedes" };
    case "replaces":
      return { relationType: "supersedes", rawPredicate: value.trim() };
    case "contradicts":
      return { relationType: "contradicts" };
    case "conflicts_with":
      return { relationType: "contradicts", rawPredicate: value.trim() };
    case "resolved_by":
      return { relationType: "resolved_by" };
    case "resolved_with":
      return { relationType: "resolved_by", rawPredicate: value.trim() };
    case "corrected_by":
      return { relationType: "resolved_by", rawPredicate: "corrected_by" };
    case "fixed_by":
      return { relationType: "resolved_by", rawPredicate: "fixed_by" };
    case "related_to":
      return { relationType: "related_to" };
    case "met":
      return { relationType: "related_to", rawPredicate: "met" };
    case "introduced_to":
      return { relationType: "related_to", rawPredicate: "introduced_to" };
    case "contacted":
      return { relationType: "related_to", rawPredicate: "contacted" };
    case "exchanged_numbers_with":
      return { relationType: "related_to", rawPredicate: "exchanged_numbers_with" };
    case "followed_up_with":
      return { relationType: "related_to", rawPredicate: "followed_up_with" };
    default:
      return null;
  }
}

function singleAnchorSupport(text: string, anchor: string): number {
  const normalizedText = normalizeText(text);
  const normalizedAnchor = normalizeText(anchor);
  if (!normalizedText || !normalizedAnchor) {
    return 0;
  }
  const compactText = normalizeName(text).replace(/[^\p{L}\p{N}]+/gu, "");
  const compactAnchor = normalizeName(anchor).replace(/[^\p{L}\p{N}]+/gu, "");
  if (normalizedText === normalizedAnchor || compactText === compactAnchor) {
    return 1;
  }
  if (
    compactAnchor.length >= 3 &&
    compactText.includes(compactAnchor) &&
    !QUESTION_LIKE_PATTERNS.some((pattern) => pattern.test(anchor))
  ) {
    return 0.96;
  }
  const anchorTokens = tokenizeSearchTerms(anchor, new Set());
  const textTokens = tokenizeSearchTerms(text, new Set());
  if (anchorTokens.length === 0 || textTokens.length === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of anchorTokens) {
    if (textTokens.includes(token)) {
      overlap += 1;
    }
  }
  const recall = overlap / Math.max(anchorTokens.length, 1);
  return recall >= 1 ? 0.92 : recall * 0.88;
}

export function queryAnchorSupport(text: string, anchors: string[]): number {
  if (anchors.length === 0) {
    return 0;
  }
  return anchors.reduce((best, anchor) => Math.max(best, singleAnchorSupport(text, anchor)), 0);
}

export function expandStateKeyAliases(key: string): string[] {
  const canonical = canonicalStateKey(key);
  return [...(STATE_KEY_ALIASES[canonical] ?? [key])];
}

export function canonicalStateKey(key: string): keyof typeof STATE_KEY_ALIASES {
  for (const [canonical, aliases] of Object.entries(STATE_KEY_ALIASES)) {
    if (aliases.includes(key as never)) {
      return canonical as keyof typeof STATE_KEY_ALIASES;
    }
  }
  return key as keyof typeof STATE_KEY_ALIASES;
}

export function normalizedEntityId(name: string, type = "unknown"): string {
  return `${normalizeName(name)}:${type}`;
}
