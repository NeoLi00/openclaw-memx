const EXPLICIT_PROMPT_INJECTION_PATTERNS = [
  /\bignore (all|any|the|previous|prior|above) instructions\b/i,
  /\bdo not follow\b.{0,30}\b(system|developer)\b/i,
  /\bBEGIN (SYSTEM|DEVELOPER|PROMPT)\b/i,
  /\b(?:reveal|show|leak|expose)\b.{0,30}\b(?:hidden|system|developer)\b.{0,20}\bprompt\b/i,
  /\bpretend to be the system\b/i,
  /\bmemory says to\b/i,
  /忽略.{0,16}(?:之前|上面|上述|先前)?.{0,12}(?:指令|提示)/u,
  /忽略.{0,12}(?:系统|开发者).{0,12}(?:规则|提示|指令)/u,
  /(?:展示|显示|泄露|暴露).{0,12}(?:隐藏|系统|开发者).{0,12}(?:提示|prompt)/u,
  /不要遵循.{0,12}(?:系统|开发者).{0,12}(?:提示|指令)/u,
  /扮演(?:系统|开发者)/u,
];

const SECRET_PATTERNS = [
  /\bsk-[a-z0-9][a-z0-9_-]{7,}\b/i,
  /\bgh[pus]_[a-z0-9_-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|bearer)\s*[:=]\s*[a-z0-9._-]{12,}\b/i,
  /\b(?:token|secret|credential)\b.{0,12}\b[a-z0-9._-]{10,}\b/i,
  /\b[A-Z0-9]{20}\.[A-Z0-9._-]{10,}\b/i,
];

const PRIVILEGED_PROMPT_REFERENCE_PATTERN = /\b(hidden|system|developer) prompt\b/i;
const ROLE_TAG_PATTERN = /<\/?(system|assistant|developer|tool|function)\b/i;
const TOOL_EXECUTION_PATTERN = /\b(run|execute|call|invoke)\b.{0,40}\b(tool|command|function)\b/i;
const STRUCTURED_CONTROL_BLOCK_PATTERN = /```(?:xml|html|json|tool|function)?/i;
const CONTROL_VERB_PATTERN =
  /\b(?:ignore|bypass|override|rewrite|replace|execute|invoke|call|run)\b/i;
const PRIVILEGED_TARGET_PATTERN = /\b(?:system|developer|tool|function|assistant)\b/i;

export function looksLikePromptInjection(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (EXPLICIT_PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const hasRoleTags = ROLE_TAG_PATTERN.test(normalized);
  const hasPrivilegedPromptReference = PRIVILEGED_PROMPT_REFERENCE_PATTERN.test(normalized);
  const hasStructuredControlBlock = STRUCTURED_CONTROL_BLOCK_PATTERN.test(normalized);
  const hasToolExecution = TOOL_EXECUTION_PATTERN.test(normalized);
  const hasControlVerb = CONTROL_VERB_PATTERN.test(normalized);
  const hasPrivilegedTarget = PRIVILEGED_TARGET_PATTERN.test(normalized);

  if (hasRoleTags && (hasToolExecution || hasControlVerb)) {
    return true;
  }

  if (hasPrivilegedPromptReference && hasControlVerb && hasPrivilegedTarget) {
    return true;
  }

  if (
    hasStructuredControlBlock &&
    (hasRoleTags || hasPrivilegedPromptReference) &&
    (hasToolExecution || hasControlVerb)
  ) {
    return true;
  }

  return false;
}

export function containsLikelySecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}
