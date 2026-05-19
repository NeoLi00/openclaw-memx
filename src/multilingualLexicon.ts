export type CjkFamilyScript = "han" | "hiragana" | "katakana" | "hangul";

const WORD_SEGMENTER =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

const WORDLIKE_FALLBACK_RE = /[\p{L}\p{N}_.:+#\/-]+/gu;
const CJK_FAMILY_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_FAMILY_ONLY_RE =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

const SCRIPT_TESTS: Array<[CjkFamilyScript, RegExp]> = [
  ["han", /\p{Script=Han}/u],
  ["hiragana", /\p{Script=Hiragana}/u],
  ["katakana", /\p{Script=Katakana}/u],
  ["hangul", /\p{Script=Hangul}/u],
];

export function cjkFamilyScripts(value: string): CjkFamilyScript[] {
  return SCRIPT_TESTS.flatMap(([script, pattern]) =>
    pattern.test(value) ? [script] : [],
  );
}

export function hasCjkFamilyScript(value: string): boolean {
  return CJK_FAMILY_RE.test(value);
}

export function isCjkFamilyToken(value: string): boolean {
  return CJK_FAMILY_ONLY_RE.test(value);
}

export function wordLikeSegments(value: string): string[] {
  if (!value) {
    return [];
  }
  if (!WORD_SEGMENTER) {
    return value.match(WORDLIKE_FALLBACK_RE) ?? [];
  }
  const segments: string[] = [];
  for (const segment of WORD_SEGMENTER.segment(value)) {
    if (segment.isWordLike) {
      segments.push(segment.segment);
    }
  }
  return segments;
}

export function expandCjkFamilySubwords(token: string): string[] {
  // Segmenters provide word-level terms; subwords are only a lexical recall fallback
  // for scripts where whitespace and tokenization are unreliable.
  if (!isCjkFamilyToken(token) || token.length <= 2) {
    return [token];
  }
  const windows = new Set<string>([token]);
  for (let size = 2; size <= Math.min(3, token.length); size += 1) {
    for (let index = 0; index <= token.length - size; index += 1) {
      windows.add(token.slice(index, index + size));
    }
  }
  return [...windows];
}
