import type { MemoryCandidateRelationHint, RouteDecision } from "../../types.js";
import {
  cleanProjectName,
  isDeicticWorkflowReferenceQuery,
  isLowValueChatter,
  isQuestionLike,
  looksLikeProjectDescriptor,
  parseAllRelations,
  parseRelation,
  prototypeSimilarity,
  stripLead,
  trimCapturedValue,
  wantsProjectProfileSnapshot,
} from "./heuristics.js";

const PREFERENCE_STOPWORDS = new Set([
  "i",
  "the",
  "to",
  "默认",
  "回答",
  "输出",
  "回复",
  "一点",
  "一下",
  "尽量",
  "更",
]);

const PREFERENCE_PROTOTYPES = {
  language: [
    "I prefer bilingual answers",
    "answer in English only",
    "answer in Chinese only",
    "之后默认都给我中英双语",
    "就纯中文吧",
    "只要英文回答",
  ],
  conciseStyle: ["keep responses concise", "技术解释尽量简洁"],
  detailedStyle: ["prefer detailed responses", "回答详细一点"],
  charset: ["Prefer ASCII-only output", "输出尽量保持 ASCII", "只用 ASCII"],
  outputOrder: [
    "Chinese first and English second",
    "中文在前英文在后",
    "English first Chinese second",
  ],
} as const;

const WORKFLOW_PROTOTYPES = {
  blocker: [
    "blocked on graph expansion",
    "current blocker is not clear",
    "当前 blocker 是",
    "当前卡点是",
  ],
  nextAction: [
    "next step is to write tests",
    "later I still need to add tests",
    "后面还要补 tests",
    "下一步做什么",
  ],
  currentTask: [
    "I am working on retrieval routing",
    "current task is retrieval routing",
    "我现在在做 retrieval routing",
    "当前任务是",
  ],
  activeProject: [
    "I am working on the memx plugin",
    "active project is memx plugin",
    "我要做一个 OpenClaw memory plugin",
    "当前项目是",
  ],
} as const;

const ROUTE_PROTOTYPES = {
  workflow: [
    "what was I doing",
    "what am I doing now",
    "what am i doing now",
    "what is my blocker",
    "what should I do next",
    "我刚才在做什么",
    "我现在在做什么",
    "当前卡点是什么",
    "下一步应该做什么",
  ],
  factual: [
    "what do I prefer",
    "what is my answer preference",
    "what is it called",
    "what version is it",
    "我偏好什么回答风格",
    "我记住了什么事实",
    "那个叫什么",
    "用的什么技术",
  ],
  explanatory: [
    "why does this depend on that",
    "how are these connected",
    "为什么会间接依赖",
    "怎么连起来的",
  ],
  temporal: [
    "what happened before",
    "what problems did I hit",
    "what happened recently",
    "do you remember",
    "我之前有过什么其它事件吗",
    "遇到过哪些问题",
    "后来怎么解决的",
    "你还记得吗",
    "前面说过什么",
  ],
} as const;

export type PreferenceJudgment = {
  predicate: string;
  object: string;
  confidence: number;
  reason: string;
};

export type WorkflowJudgment = {
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  reason: string;
};

function confidenceFromScore(score: number, base = 0.42): number {
  return Math.max(base, Math.min(0.96, score));
}

function hasPreferenceDirectiveContext(text: string): boolean {
  return (
    /\b(?:i prefer|prefer|default(?: to)?|please|keep|make|respond|answer|output|reply)\b/iu.test(
      text,
    ) || /(?:偏好|喜欢|默认|尽量|请|回答|回复|输出|解释|风格|格式|用中文|用英文|双语)/u.test(text)
  );
}

function hasResponseTargetContext(text: string): boolean {
  return (
    /\b(?:answer|response|reply|output|format|style|tone|explanation)\b/iu.test(text) ||
    /(?:回答|回复|输出|格式|风格|语气|解释)/u.test(text)
  );
}

function languagePreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  const score = prototypeSimilarity(
    stripped,
    [...PREFERENCE_PROTOTYPES.language],
    PREFERENCE_STOPWORDS,
  );
  const directiveContext =
    hasPreferenceDirectiveContext(stripped) || hasResponseTargetContext(stripped);
  if (
    /(?:纯中文|只用中文|就用中文|就纯中文|只要中文|默认中文|中文回答|answer in chinese)/iu.test(
      stripped,
    )
  ) {
    return {
      predicate: "prefers_language",
      object: "chinese responses",
      confidence: confidenceFromScore(Math.max(score, 0.72)),
      reason: "language preference override",
    };
  }
  if (
    /(?:纯英文|只用英文|就用英文|就纯英文|只要英文|默认英文|英文回答|english(?:-only)? answers?|answer in english)/iu.test(
      stripped,
    )
  ) {
    return {
      predicate: "prefers_language",
      object: "english responses",
      confidence: confidenceFromScore(Math.max(score, 0.72)),
      reason: "language preference override",
    };
  }
  if (
    directiveContext &&
    (/(?:中英双语|双语对照|双语版本|双语回答|bilingual|dual[- ]language)/iu.test(stripped) ||
      score >= 0.38)
  ) {
    return {
      predicate: "prefers_language",
      object: "bilingual responses",
      confidence: confidenceFromScore(Math.max(score, 0.72)),
      reason: "bilingual preference",
    };
  }
  return null;
}

function outputOrderPreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  const score = prototypeSimilarity(
    stripped,
    [...PREFERENCE_PROTOTYPES.outputOrder],
    PREFERENCE_STOPWORDS,
  );
  if (/(?:中文在前.*英文在后|中文先.*英文后|chinese first.*english second)/iu.test(stripped)) {
    return {
      predicate: "prefers_output_order",
      object: "zh first, en second",
      confidence: confidenceFromScore(Math.max(score, 0.72)),
      reason: "reply ordering preference",
    };
  }
  if (/(?:英文在前.*中文在后|english first.*chinese second)/iu.test(stripped)) {
    return {
      predicate: "prefers_output_order",
      object: "en first, zh second",
      confidence: confidenceFromScore(Math.max(score, 0.72)),
      reason: "reply ordering preference",
    };
  }
  return null;
}

function stylePreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  const conciseScore = prototypeSimilarity(
    stripped,
    [...PREFERENCE_PROTOTYPES.conciseStyle],
    PREFERENCE_STOPWORDS,
  );
  const detailedScore = prototypeSimilarity(
    stripped,
    [...PREFERENCE_PROTOTYPES.detailedStyle],
    PREFERENCE_STOPWORDS,
  );
  const directiveContext =
    hasPreferenceDirectiveContext(stripped) || hasResponseTargetContext(stripped);
  if (
    directiveContext &&
    (/(?:详细|更详细|展开一点|verbose|detailed|long-form)/iu.test(stripped) || detailedScore >= 0.4)
  ) {
    return {
      predicate: "prefers_response_style",
      object: "detailed responses",
      confidence: confidenceFromScore(Math.max(detailedScore, 0.66)),
      reason: "style preference",
    };
  }
  if (
    directiveContext &&
    (/(?:简洁|精简|言简意赅|concise|compact)/iu.test(stripped) || conciseScore >= 0.4)
  ) {
    return {
      predicate: "prefers_response_style",
      object: "concise responses",
      confidence: confidenceFromScore(Math.max(conciseScore, 0.68)),
      reason: "style preference",
    };
  }
  return null;
}

function charsetPreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  const score = prototypeSimilarity(
    stripped,
    [...PREFERENCE_PROTOTYPES.charset],
    PREFERENCE_STOPWORDS,
  );
  const directiveContext =
    hasPreferenceDirectiveContext(stripped) ||
    hasResponseTargetContext(stripped) ||
    /(?:code block|代码块|终端输出|shell 输出)/iu.test(stripped);
  if (directiveContext && (/(?:ascii|纯ascii|ascii-only)/iu.test(stripped) || score >= 0.4)) {
    return {
      predicate: "prefers_output_charset",
      object: "ASCII output",
      confidence: confidenceFromScore(Math.max(score, 0.68)),
      reason: "charset preference",
    };
  }
  return null;
}

function codingPreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  const directiveContext = hasPreferenceDirectiveContext(stripped);
  // Naming conventions
  if (directiveContext && /\b(?:snake[\s_]?case|下划线命名)\b/iu.test(stripped)) {
    return {
      predicate: "prefers_naming_convention",
      object: "snake_case",
      confidence: 0.78,
      reason: "coding naming preference",
    };
  }
  if (directiveContext && /\b(?:camel[\s_]?case|驼峰命名)\b/iu.test(stripped)) {
    return {
      predicate: "prefers_naming_convention",
      object: "camelCase",
      confidence: 0.78,
      reason: "coding naming preference",
    };
  }
  // Indentation
  if (
    directiveContext &&
    /\b(?:tabs?\s+(?:not|instead|over)\s+spaces?|用\s*tab|制表符缩进)\b/iu.test(stripped)
  ) {
    return {
      predicate: "prefers_indentation",
      object: "tabs",
      confidence: 0.76,
      reason: "coding indentation preference",
    };
  }
  if (
    directiveContext &&
    /\b(?:spaces?\s+(?:not|instead|over)\s+tabs?|用\s*空格|空格缩进|[24]\s*spaces?)\b/iu.test(
      stripped,
    )
  ) {
    return {
      predicate: "prefers_indentation",
      object: "spaces",
      confidence: 0.76,
      reason: "coding indentation preference",
    };
  }
  // Paradigm
  if (
    directiveContext &&
    /\b(?:functional\s+(?:programming|style)|函数式(?:编程|风格))\b/iu.test(stripped)
  ) {
    return {
      predicate: "prefers_programming_paradigm",
      object: "functional programming",
      confidence: 0.72,
      reason: "paradigm preference",
    };
  }
  return null;
}

function experientialStylePreference(text: string): PreferenceJudgment | null {
  const stripped = stripLead(text);
  if (!stripped) {
    return null;
  }
  const referentialStyleCue =
    /(?:这种|这个|这样|按这个|照这个).{0,8}(?:节奏|方式|讲法|讲解|解释|结构|写法|安排)/u;
  const positiveReceptionCue =
    /(?:比较|更)?容易(?:跟上|理解|消化|记住)|好(?:跟上|理解)|works for me|easier to follow|helps me understand/iu;
  const followThisCue = /(?:按|照).{0,8}(?:这个|这种).{0,8}(?:来|继续|展开)/u;
  if (
    (referentialStyleCue.test(stripped) && positiveReceptionCue.test(stripped)) ||
    (referentialStyleCue.test(stripped) && followThisCue.test(stripped))
  ) {
    return {
      predicate: "prefers_explanation_style",
      object: "the demonstrated explanation rhythm and structure",
      confidence: 0.72,
      reason: "implicit positive reinforcement of an explanation style",
    };
  }
  return null;
}

export function judgePreferenceSignal(text: string): PreferenceJudgment | null {
  if (!text.trim() || isLowValueChatter(text)) {
    return null;
  }
  return (
    outputOrderPreference(text) ??
    languagePreference(text) ??
    stylePreference(text) ??
    charsetPreference(text) ??
    codingPreference(text) ??
    experientialStylePreference(text) ??
    null
  );
}

export function judgeWorkflowState(text: string): WorkflowJudgment | null {
  const stripped = stripLead(text);
  if (
    !stripped ||
    isQuestionLike(stripped) ||
    judgePreferenceSignal(stripped) ||
    parseRelation(stripped)
  ) {
    return null;
  }

  // Task suspension / pause detection (Conv 4: "放一放", "告一段落", "暂时不做了")
  const suspension = stripped.match(
    /(?:(?:先)?放一放|告一段落|暂时不做(?:了)?|暂停(?:一下)?|搁置|先不做(?:了)?|suspend|on hold|pause(?:d)?|shelve(?:d)?)\s*(.*)?/iu,
  );
  if (suspension) {
    const context = trimCapturedValue(suspension[1] ?? "");
    return {
      key: "workflow.current_task",
      value: { task: context || "(suspended)", status: "suspended" },
      confidence: confidenceFromScore(0.66),
      reason: "task suspension",
    };
  }

  const blockerScore = prototypeSimilarity(stripped, [...WORKFLOW_PROTOTYPES.blocker]);
  const blocker = stripped.match(
    /(?:\b(?:blocked on|blocker is)\b|(?:当前)?(?:blocker|卡点|卡在|阻塞点)[是:：]?)\s*(.+)/iu,
  );
  if (blocker?.[1]) {
    return {
      key: "workflow.blocker",
      value: { blocker: trimCapturedValue(blocker[1]), status: "blocked" },
      confidence: confidenceFromScore(Math.max(blockerScore, 0.74)),
      reason: "workflow blocker",
    };
  }

  const nextActionScore = prototypeSimilarity(stripped, [...WORKFLOW_PROTOTYPES.nextAction]);
  const nextAction = stripped.match(
    /(?:\b(?:next step|next action)\b(?:\s*(?:is|:))?|(?:后面(?:再|还要|要)|下一步(?:是)?|接下来(?:再|要)?|稍后(?:再)?|后续(?:再|要)?))\s*(.+)/iu,
  );
  if (nextAction?.[1]) {
    return {
      key: "workflow.next_action",
      value: { step: trimCapturedValue(nextAction[1]) },
      confidence: confidenceFromScore(Math.max(nextActionScore, 0.66)),
      reason: "workflow next action",
    };
  }

  const currentTaskScore = prototypeSimilarity(stripped, [...WORKFLOW_PROTOTYPES.currentTask]);
  const currentTask = stripped.match(
    /(?:\b(?:current task|current step|currently doing)\b(?:\s*(?:is|:))?|(?:现在先|目前先|当前任务(?:是)?|现在在做))\s*(.+)/iu,
  );
  if (currentTask?.[1]) {
    return {
      key: "workflow.current_task",
      value: { task: trimCapturedValue(currentTask[1]) },
      confidence: confidenceFromScore(Math.max(currentTaskScore, 0.62)),
      reason: "workflow current task",
    };
  }

  const directDeferredTopic = stripped.match(
    /(?:先|暂时|暂且|目前)(?:不|别)(?:改|换|动|调整|处理|推进|做)\s*(.+?)(?:了)?(?:[，,。]|$)/iu,
  );
  const deferredDecision = stripped.match(
    /(?:(?:先|暂时|暂且|目前).{0,6}(?:不|别).{0,20}|(?:先|暂时|暂且|目前).{0,20}(?:保持|沿用|继续用).{0,20})(.+?)(?:[，,。]|$).{0,36}(?:等|等到|等下次|下一轮|下次|后面|之后|later|until).{0,40}(?:再|重新)?(?:评估|决定|确认|review|revisit)/iu,
  );
  if (deferredDecision?.[1] || directDeferredTopic?.[1]) {
    const topic = trimCapturedValue(directDeferredTopic?.[1] ?? deferredDecision?.[1] ?? "");
    return {
      key: "workflow.current_consideration",
      value: {
        topic: topic || stripped,
        status: "deferred",
        decision: "pending_reassessment",
        note: stripped,
      },
      stateKind: "session",
      confidence: confidenceFromScore(0.78),
      reason: "deferred current decision",
    };
  }

  const explicitConsideration = stripped.match(
    /(?:先|暂时|目前).{0,8}(?:保持|沿用|不改|不动|先用|继续用)\s*(.+)/iu,
  );
  if (
    explicitConsideration?.[1] &&
    /(?:再评估|再决定|稍后再看|后面再看|later|revisit|review)/iu.test(stripped)
  ) {
    return {
      key: "workflow.current_consideration",
      value: {
        topic: trimCapturedValue(explicitConsideration[1]),
        status: "under_consideration",
        decision: "pending",
        note: stripped,
      },
      stateKind: "session",
      confidence: confidenceFromScore(0.72),
      reason: "current consideration with deferred reassessment",
    };
  }

  const projectScore = prototypeSimilarity(stripped, [...WORKFLOW_PROTOTYPES.activeProject]);
  const project = stripped.match(
    /(?:\b(?:active project|project)\b(?:\s*(?:is|:))?|(?:当前项目(?:是)?|项目[:：]|我要做(?:一个|个)?|我在做|正在做|working on))\s*(.+)/iu,
  );
  if (project?.[1]) {
    const projectName = cleanProjectName(project[1]);
    if (projectName) {
      if (
        !looksLikeProjectDescriptor(projectName) &&
        /^(?:working on|我在做|正在做)/iu.test(stripped)
      ) {
        return {
          key: "workflow.current_task",
          value: { task: projectName },
          confidence: confidenceFromScore(Math.max(projectScore, 0.58)),
          reason: "workflow task from project-like clause",
        };
      }
      return {
        key: "project.active_project",
        value: { project: projectName, status: "active" },
        confidence: confidenceFromScore(Math.max(projectScore, 0.62)),
        reason: "active project",
      };
    }
  }

  return null;
}

export function judgeRelationHint(text: string): MemoryCandidateRelationHint | null {
  const relation = parseRelation(text);
  if (!relation) {
    return null;
  }
  return {
    subject: relation.subject,
    predicate: relation.predicate,
    object: relation.object,
    rawPredicate: relation.rawPredicate,
    confidence: 0.82,
    reason: "relation extraction",
  };
}

export function judgeAllRelationHints(text: string): MemoryCandidateRelationHint[] {
  return parseAllRelations(text).map((relation) => ({
    subject: relation.subject,
    predicate: relation.predicate,
    object: relation.object,
    rawPredicate: relation.rawPredicate,
    confidence: 0.82,
    reason: "relation extraction",
  }));
}

export function judgeQueryRoute(query: string): RouteDecision {
  const deicticWorkflowReference = isDeicticWorkflowReferenceQuery(query);
  const projectProfileSnapshot = wantsProjectProfileSnapshot(query);
  const cueMatches = {
    workflow:
      /(?:在做什么|当前项目|当前任务|下一步|卡点|卡在|前一个|回到|切换|blocker|project|task|next step|what am i doing|what was i doing|doing now|working on|switch(?:ed)? to)/iu.test(
        query,
      ) || deicticWorkflowReference,
    factual:
      /(?:偏好|回答风格|回答格式|输出偏好|叫什么|是什么|用的什么|什么技术栈|什么版本|prefer|preference|format|style|what is|what was|called|named)/iu.test(
        query,
      ) || projectProfileSnapshot,
    explanatory: /(?:为什么|怎么连起来|依赖|关系|depends|relationship|chain)/iu.test(query),
    temporal:
      /(?:之前|以前|前面|历史|发生了什么|事件|问题|recent|history|happened|last week)/iu.test(
        query,
      ),
  };
  const scores = {
    workflow:
      prototypeSimilarity(query, [...ROUTE_PROTOTYPES.workflow]) + (cueMatches.workflow ? 0.24 : 0),
    factual:
      prototypeSimilarity(query, [...ROUTE_PROTOTYPES.factual]) + (cueMatches.factual ? 0.24 : 0),
    explanatory:
      prototypeSimilarity(query, [...ROUTE_PROTOTYPES.explanatory]) +
      (cueMatches.explanatory ? 0.24 : 0),
    temporal:
      prototypeSimilarity(query, [...ROUTE_PROTOTYPES.temporal]) + (cueMatches.temporal ? 0.24 : 0),
  };
  const ordered = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topType, topScore] = ordered[0] ?? ["unknown", 0];
  const secondScore = ordered[1]?.[1] ?? 0;
  const strongCues = Object.entries(cueMatches).filter(([, matched]) => matched);

  if (topScore < 0.22) {
    return {
      routeType: "unknown",
      routeConfidence: 0.25,
      reasons: ["no strong semantic route"],
    };
  }

  if (strongCues.length >= 2) {
    return {
      routeType: "mixed",
      routeConfidence: Math.max(0.58, Math.min(0.78, topScore)),
      reasons: strongCues.map(([name]) => `cue:${name}`),
    };
  }

  if (topScore - secondScore < 0.12 && secondScore >= 0.22) {
    return {
      routeType: "mixed",
      routeConfidence: Math.max(0.45, Math.min(0.7, topScore)),
      reasons: ordered
        .filter(([, score]) => score >= secondScore)
        .slice(0, 2)
        .map(([name, score]) => `semantic:${name}:${score.toFixed(2)}`),
    };
  }

  return {
    routeType: topType as RouteDecision["routeType"],
    routeConfidence: Math.max(0.55, Math.min(0.9, topScore)),
    reasons: [`semantic:${topType}:${topScore.toFixed(2)}`],
  };
}

export function routeWorkflow(query: string): boolean {
  return judgeQueryRoute(query).routeType === "workflow";
}

export function routeFactual(query: string): boolean {
  return judgeQueryRoute(query).routeType === "factual";
}

export function routeExplanatory(query: string): boolean {
  return judgeQueryRoute(query).routeType === "explanatory";
}

export function routeTemporal(query: string): boolean {
  return judgeQueryRoute(query).routeType === "temporal";
}
