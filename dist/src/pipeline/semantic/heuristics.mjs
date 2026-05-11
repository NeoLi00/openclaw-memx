import { isValidEntityName, normalizeName, normalizeText, normalizedTerms } from "../../support.mjs";
import { looksLikeProjectDescriptor as looksLikeProjectDescriptor$1 } from "../projectIdentity.mjs";
//#region src/pipeline/semantic/heuristics.ts
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
	/别忘了/u
];
const LOW_VALUE_PATTERNS = [/^\s*(?:hi|hello|thanks|thank you|ok|okay|sure)\s*[.!?]*\s*$/i, /^\s*(?:你好|嗨|谢谢|多谢|好的|好哦|收到|嗯嗯|哈哈+|lol)\s*[。.!！?？]*\s*$/iu];
const QUESTION_LIKE_PATTERNS = [/^\s*(?:what|why|how|when|where|who|do|does|did|can|could|would|should|is|are|am)\b/i, /(?:吗|？|\?|什么|怎么|为何|为什么|谁|哪里|哪儿|如何|是否|有没有|记不记得|还记得)/u];
const TIME_HINT_PATTERN = /\b(?:today|yesterday|tomorrow|last week|last month|next week|recently|before|after|later|then|first|second|third|\d{4}-\d{2}-\d{2}|(?:this|last|next) year \d{1,2})\b|(?:今天|昨天|明天|上周|上个月|下周|最近|之前|前面|后来|后面|最后|第一次|第二次|第三次|(?:今|去|前|明)年(?:[一二三四五六七八九十]{1,3}|\d{1,2})月)/giu;
const CONSTRAINT_QUERY_PATTERNS = [/\b(?:constraint|must use)\b/i, /(?:约束|必须用|只能用)/u];
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
	"格式"
]);
const WORKFLOW_DEICTIC_REFERENCE_PATTERN = /(?:前一个项目|上一个项目|previous project|last project|回到.+那边|搜索那边|那条线|这条线|哪条线|那边|这边|接上.+上下文|带上.+上下文|恢复.+上下文)/iu;
const PROJECT_PROFILE_FACT_PATTERN = /(?:技术栈|组件|版本|当前有效|仍然有效|最终结论|现在用的什么|当前用的什么|stack|components?|version|current valid|still valid|final conclusion)/iu;
const HISTORICAL_PROJECT_PROFILE_PATTERN = /(?:后来|之前|以前|变成|换成|迁移到|从.+换到|history|historical|used to|before|after)/iu;
const CURRENT_CORRECTION_PATTERN = /(?:现在|目前|当前).{0,20}(?:不是|不再是|已经不是|改成|换成)|(?:not|no longer).{0,12}(?:is|are|using)|(?:now|currently).{0,20}(?:is|are|uses?|using|set to)/iu;
const HISTORICAL_CORRECTION_PATTERN = /(?:以前|之前|原来|曾经|过去|后来|之后|从.+(?:改成|换成|迁移到)|used to|previously|before|later|switched from|changed from)/iu;
const COMPARISON_CORRECTION_PATTERN = /(?:以前.*现在|之前.*现在|原来.*现在|过去.*现在|对比|compare|difference|still|还.*吗|现在还是|过去和现在)/iu;
const CURRENT_SNAPSHOT_QUERY_PATTERN = /(?:现在仍然有效(?:的设定|的信息)?|当前有效(?:的设定|的信息)?|目前有效(?:的设定|的信息)?|仍然有效(?:的设定|的信息)?|当前配置|当前设定|当前状态|现在用什么|当前用什么|当前技术栈|still valid|current valid|current configuration|current state|current stack)/iu;
const HISTORICAL_QUERY_PATTERN = /(?:最早|最初|早期|历史|曾经|之前|以前|过去|旧记录|旧版|那一版|哪一版|内部试运行|内测|历史信息|旧称|旧名|别名|代号|historical|history|earliest|original|early version|used to|before|old name|alias|codename)/iu;
const EXACT_DETAIL_QUERY_PATTERN = /(?:多少|几|第几|几点|几号|哪天|百分之几|版本|名字|名称|叫(?:什么|啥)|技术栈|stack|具体|详细|公测时间|上线时间|什么时候|最早那版|哪一版|别名|代号|what exact|how much|how many|percentage|version|name|called)/iu;
const DEICTIC_QUERY_PATTERN = /(?:那个|那边|这个|这边|它|他|她|them|that|this|it|those)/iu;
const WORKFLOW_CONTEXT_QUERY_PATTERN = /(?:在做什么|当前项目|当前任务|下一步|卡点|卡在|前一个|回到|切换|blocker|project|task|next step|what am i doing|what was i doing|doing now|working on|switch(?:ed)? to|再看|继续|接着|回到.+那边)/iu;
const ALIAS_RESOLUTION_QUERY_PATTERN = /(?:别名|代号|旧称|旧名|alias|codename|怎么理解|如何理解|what should i understand|how should i interpret)/iu;
const CHANGE_OPERATOR_PATTERN = /(?:不是|而不是|不再是|已经不是|改成|换成|切到|迁移到|从.+(?:改成|换成|切到|迁移到)|才是|应该保留为历史|保留为历史|视为历史|算(?:作|是)|不能默认|不要当成|别把.+当成|不能被说成|现已不用|已经不用|instead of|rather than|no longer|used to|switched from|changed from)/iu;
const SUMMARY_REQUEST_PATTERN = /(?:整理成一句话|总结(?:一下)?|概括(?:一下)?|归纳(?:一下)?|再整理|重新整理|重新表述|用一句话|一句话总结|一句话概括|summari[sz]e|summarize|restate|recap)/iu;
const STATE_KEY_ALIASES = {
	"project.active_project": ["project.active_project", "active_project"],
	"workflow.current_task": ["workflow.current_task", "current_task"],
	"workflow.current_consideration": [
		"workflow.current_consideration",
		"current_consideration",
		"workflow_candidate_decision"
	],
	"workflow.next_action": ["workflow.next_action", "workflow_next_step"],
	"workflow.blocker": ["workflow.blocker", "workflow_blocker"]
};
function matchesAny(text, patterns) {
	return patterns.some((pattern) => pattern.test(text));
}
function prototypeSimilarity(text, prototypes, stopwords) {
	const source = tokenizeSearchTerms(text, stopwords ?? /* @__PURE__ */ new Set());
	if (source.length === 0) return 0;
	let best = 0;
	for (const prototype of prototypes) {
		const target = tokenizeSearchTerms(prototype, stopwords ?? /* @__PURE__ */ new Set());
		if (target.length === 0) continue;
		let overlap = 0;
		for (const token of source) if (target.includes(token)) overlap += 1;
		best = Math.max(best, overlap / Math.max(Math.min(source.length, target.length), 1));
	}
	return best;
}
function tokenizeSearchTerms(text, stopwords) {
	return normalizedTerms(text, {
		stopwords: new Set([...stopwords, ...CHINESE_BIGRAM_STOPWORDS]),
		minLength: 2
	});
}
function hasExplicitRememberIntent(text) {
	return matchesAny(text, EXPLICIT_REMEMBER_PATTERNS);
}
const MEMORY_ARTIFACT_PREFIX_PATTERN = /^\s*(?:\[(?:answer|context|resource|event|support)\]\s*)?(?:\d{4}-\d{2}-\d{2}\s+conversation_turn:\s*)?(?:(?:\[?user\]?)\s*:?\s*)?(?:reported_detail\s+|observation:\s*)?/iu;
const BARE_MEMORY_USE_INSTRUCTION_PATTERNS = [
	/^(?:that|this|it|the above|the previous(?: answer)?|the last(?: answer)?)\s+(?:is|was|should be)\s+(?:the\s+)?answer\b.{0,120}\b(?:later|if (?:this|it) comes up|when (?:i|we|the user) ask|for later)\b/iu,
	/^(?:remember|save|keep|note|use)\s+(?:this|that|it|the above|the previous(?: answer)?|this answer|that answer)\b.{0,120}\b(?:later|if|when|for)\b/iu,
	/^if\s+(?:asked|this comes up|it comes up)\s+later\b.{0,120}\b(?:answer|use|remember)\b/iu,
	/^(?:这|这个|这条|上面|刚才|前面).{0,16}(?:答案|结论).{0,40}(?:以后|之后|下次|问到|提到|用)/u,
	/^(?:以后|之后|下次).{0,16}(?:问到|提到).{0,16}(?:就用|用).{0,12}(?:这个|这条|上面|刚才|前面)(?:答案|结论)?/u
];
function stripMemoryArtifactPrefix(text) {
	return text.trim().replace(MEMORY_ARTIFACT_PREFIX_PATTERN, "").trim();
}
function looksLikeBareMemoryUseInstruction(text) {
	const stripped = stripMemoryArtifactPrefix(text);
	if (!stripped) return false;
	if (!matchesAny(stripped, BARE_MEMORY_USE_INSTRUCTION_PATTERNS)) return false;
	if (/[:：]\s*\S{3,}/u.test(stripped)) return false;
	return true;
}
const BARE_INSTRUCTIONAL_GUIDANCE_PATTERNS = [/^(?:please\s+)?(?:check|inspect|verify|review|look at|try|run|use|avoid|do not|don't|make sure|keep|call|ask|update)\b/iu, /^(?:先|请)?(?:检查|确认|验证|看看|查看|运行|使用|避免|不要|别|先看|先查|记得)\b/u];
function looksLikeBareInstructionalGuidance(text) {
	const stripped = stripMemoryArtifactPrefix(text);
	if (!stripped) return false;
	return matchesAny(stripped, BARE_INSTRUCTIONAL_GUIDANCE_PATTERNS);
}
function isLowValueChatter(text) {
	return matchesAny(text, LOW_VALUE_PATTERNS);
}
function isQuestionLike(text) {
	return matchesAny(text.trim(), QUESTION_LIKE_PATTERNS);
}
function extractTimeHints(text) {
	return text.match(TIME_HINT_PATTERN) ?? [];
}
function stripLead(text) {
	return text.trim().replace(/^(?:please remember(?: that)?|remember(?: that)?|note that|save this)\s+/i, "").replace(/^(?:请|帮我)?记住(?:这条|这个|一下)?[:：]?\s*/u, "").replace(/^记一下[:：]?\s*/u, "").replace(/^记下来[:：]?\s*/u, "").trim();
}
function trimCapturedValue(value) {
	return value.trim().replace(/^[“"'`]+/, "").replace(/[”"'`]+$/, "").replace(/^[是:：-]\s*/u, "").replace(/[。.!！?？]+$/u, "").trim();
}
function cleanProjectName(value) {
	return trimCapturedValue(value).replace(/^(?:a|an|the)\s+/i, "").replace(/^(?:一个|个)\s*/u, "").trim();
}
function looksLikeProjectDescriptor(value) {
	return looksLikeProjectDescriptor$1(value);
}
const KNOWN_LANGUAGES = new Set([
	"java",
	"python",
	"javascript",
	"typescript",
	"go",
	"golang",
	"rust",
	"c",
	"c++",
	"c#",
	"ruby",
	"php",
	"swift",
	"kotlin",
	"scala",
	"perl",
	"lua",
	"r",
	"elixir",
	"erlang",
	"haskell",
	"clojure",
	"dart",
	"zig",
	"nim",
	"ocaml"
]);
const KNOWN_SERVICES = new Set([
	"redis",
	"postgresql",
	"postgres",
	"mysql",
	"mariadb",
	"mongodb",
	"sqlite",
	"kafka",
	"rabbitmq",
	"nats",
	"pulsar",
	"celery",
	"temporal",
	"elasticsearch",
	"opensearch",
	"memcached",
	"dynamodb",
	"cassandra",
	"nginx",
	"apache",
	"docker",
	"kubernetes",
	"k8s"
]);
const KNOWN_TOOLS = new Set([
	"react",
	"vue",
	"angular",
	"svelte",
	"next.js",
	"nextjs",
	"nuxt",
	"webpack",
	"vite",
	"esbuild",
	"rollup",
	"babel",
	"eslint",
	"prettier",
	"jest",
	"vitest",
	"mocha",
	"cypress",
	"playwright",
	"git",
	"npm",
	"yarn",
	"pnpm",
	"bun",
	"deno",
	"node",
	"node.js",
	"spring",
	"django",
	"flask",
	"express",
	"fastapi",
	"rails",
	"graphql",
	"grpc",
	"rest",
	"protobuf"
]);
const KNOWN_FRAMEWORKS = new Set([
	"spring boot",
	"spring",
	"django",
	"flask",
	"express",
	"fastapi",
	"rails",
	"laravel",
	"nestjs",
	".net",
	"asp.net"
]);
const TAG_PREFIX_TYPE_MAP = {
	project: "project",
	repo: "project",
	package: "tool",
	module: "tool",
	项目: "project",
	仓库: "project",
	包: "tool",
	模块: "tool"
};
/**
* Infer entity type from name and optional predicate context.
* Uses a known-name lookup table, suffix heuristics, and predicate hints.
*/
function inferEntityType(name, predicateHint) {
	const lower = name.trim().toLowerCase();
	if (KNOWN_LANGUAGES.has(lower)) return "language";
	if (KNOWN_SERVICES.has(lower)) return "service";
	if (KNOWN_TOOLS.has(lower)) return "tool";
	if (KNOWN_FRAMEWORKS.has(lower)) return "framework";
	if (/\.(?:js|ts|py|rb|go|rs|java|kt|swift)$/i.test(lower)) return "tool";
	if (/[-_](?:cli|sdk|api|lib|plugin|server|client)$/i.test(lower)) return "tool";
	if (/[-_](?:db|cache|queue|broker|store)$/i.test(lower)) return "service";
	if (predicateHint) {
		if (predicateHint === "owner_of") return "person";
		if (predicateHint === "uses" || predicateHint === "depends_on") return "tool";
	}
	return "unknown";
}
function latinEntityMatches(text) {
	return (text.match(/\b[A-Za-z][A-Za-z0-9_.-]{1,}(?:\s+[A-Za-z][A-Za-z0-9_.-]{1,}){0,3}/g) ?? []).map((match) => trimCapturedValue(match)).filter((match) => match.length > 1);
}
function quotedEntityMatches(text) {
	return (text.match(/["“”'‘’《》〈〉「」『』【】]([^"“”'‘’《》〈〉「」『』【】\n]{2,60})["“”'‘’《》〈〉「」『』【】]/gu) ?? []).map((span) => trimCapturedValue(span.slice(1, -1))).filter((entry) => entry.length > 1);
}
function taggedEntityMatches(text) {
	return [...text.matchAll(/(?:project|repo|package|module|项目|仓库|包|模块)\s+([A-Za-z0-9_.\-\p{Script=Han}][A-Za-z0-9_.\-\p{Script=Han}\s]{1,58})/giu)].map((match) => {
		const tagWord = match[0].split(/\s+/)[0].toLowerCase();
		return {
			name: trimCapturedValue(match[1] ?? ""),
			tagType: TAG_PREFIX_TYPE_MAP[tagWord] ?? "unknown"
		};
	}).filter((entry) => entry.name.length > 0);
}
function normalizeGraphRelationType(value) {
	switch (value.trim().toLowerCase().replace(/\s+/g, "_")) {
		case "depends_on": return { relationType: "depends_on" };
		case "depends": return {
			relationType: "depends_on",
			rawPredicate: value.trim()
		};
		case "blocks": return { relationType: "blocks" };
		case "blocked_by": return {
			relationType: "blocks",
			rawPredicate: value.trim()
		};
		case "caused_by": return { relationType: "caused_by" };
		case "because_of": return {
			relationType: "caused_by",
			rawPredicate: value.trim()
		};
		case "uses": return { relationType: "uses" };
		case "reads":
		case "reads_from": return {
			relationType: "uses",
			rawPredicate: value.trim()
		};
		case "part_of": return { relationType: "part_of" };
		case "owner_of": return { relationType: "owner_of" };
		case "owned_by": return {
			relationType: "owner_of",
			rawPredicate: value.trim()
		};
		case "supersedes": return { relationType: "supersedes" };
		case "replaces": return {
			relationType: "supersedes",
			rawPredicate: value.trim()
		};
		case "contradicts": return { relationType: "contradicts" };
		case "conflicts_with": return {
			relationType: "contradicts",
			rawPredicate: value.trim()
		};
		case "resolved_by": return { relationType: "resolved_by" };
		case "resolved_with": return {
			relationType: "resolved_by",
			rawPredicate: value.trim()
		};
		case "corrected_by": return {
			relationType: "resolved_by",
			rawPredicate: "corrected_by"
		};
		case "fixed_by": return {
			relationType: "resolved_by",
			rawPredicate: "fixed_by"
		};
		case "related_to": return { relationType: "related_to" };
		case "met": return {
			relationType: "related_to",
			rawPredicate: "met"
		};
		case "introduced_to": return {
			relationType: "related_to",
			rawPredicate: "introduced_to"
		};
		case "contacted": return {
			relationType: "related_to",
			rawPredicate: "contacted"
		};
		case "exchanged_numbers_with": return {
			relationType: "related_to",
			rawPredicate: "exchanged_numbers_with"
		};
		case "followed_up_with": return {
			relationType: "related_to",
			rawPredicate: "followed_up_with"
		};
		default: return null;
	}
}
function looksLikePersonName(value) {
	const trimmed = trimCapturedValue(value);
	if (!trimmed) return false;
	return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/u.test(trimmed) || /^[\p{Script=Han}]{2,10}$/u.test(trimmed);
}
function pushUniqueRelation(target, seen, relation) {
	if (!relation) return;
	const subject = trimCapturedValue(relation.subject);
	const object = trimCapturedValue(relation.object);
	if (!subject || !object) return;
	const key = `${normalizeName(subject)}:${relation.predicate}:${normalizeName(object)}:${relation.rawPredicate ?? ""}`;
	if (seen.has(key)) return;
	seen.add(key);
	target.push({
		...relation,
		subject,
		object
	});
}
function splitCoordinatedPersonNames(value) {
	const normalized = trimCapturedValue(value).replace(/\s+\b(?:at|from|near|in|on|by|with|who|that|which)\b.*$/iu, "").replace(/\s+(?:who|whom|that)\b.*$/iu, "").replace(/\s+(?:that|who)\s+I\b.*$/iu, "").trim();
	if (!normalized) return [];
	const parts = normalized.split(/\s*(?:,|and|&|、|和|跟)\s*/u).map((part) => trimCapturedValue(part)).filter(Boolean);
	if (parts.length <= 1) return looksLikePersonName(normalized) ? [normalized] : [];
	return parts.filter((part) => looksLikePersonName(part));
}
function firstPersonSubject(text) {
	if (/\b(?:i|we|my|our)\b/iu.test(text) || /(?:我|我们|我的|咱们)/u.test(text)) return "user";
	return null;
}
function extractSocialRelations(text) {
	const stripped = stripLead(text);
	const clauses = [stripped, ...stripped.split(/[，,；;。]/u).flatMap((part) => part.split(/[：:]/u)).map((part) => trimCapturedValue(part)).filter(Boolean)].filter((entry, index, all) => all.indexOf(entry) === index);
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	const addPeople = (predicate, people, subjectText) => {
		const subject = firstPersonSubject(subjectText);
		if (!subject) return;
		for (const person of people) {
			if (!isValidEntityName(person)) continue;
			pushUniqueRelation(results, seen, {
				subject,
				predicate: "related_to",
				object: person,
				rawPredicate: predicate
			});
		}
	};
	const pushMatches = (clause, regex, predicate, transform = splitCoordinatedPersonNames) => {
		for (const match of clause.matchAll(regex)) {
			const captured = trimCapturedValue(match[1] ?? "");
			if (!captured) continue;
			addPeople(predicate, transform(captured), clause);
		}
	};
	for (const clause of clauses) {
		if (!clause) continue;
		pushMatches(clause, /\b(?:i|we)\s+(?:met|meet|met up with|bumped into|ran into|reconnected with|connected with|caught up with)\s+(?:[^,.!?;\n]{0,80}?\bnamed\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s*(?:,|and|&)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})*)/giu, "met");
		pushMatches(clause, /\b(?:met|meet|met up with|bumped into|ran into)\s+(?:[^,.!?;\n]{0,80}?\bnamed\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/giu, "met", (captured) => [captured]);
		pushMatches(clause, /\bmy\s+(?:friend|friends|contact|contacts|colleague|colleagues)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s*(?:,|and|&)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})*)\s*,\s*who\s+i\s+met\b/giu, "met");
		pushMatches(clause, /\b(?:i|we)\s+(?:exchanged numbers|swapped numbers|exchanged contact(?: information)?|traded contact(?: information)?|got in touch)\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s*(?:,|and|&)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})*)/giu, "exchanged_numbers_with");
		pushMatches(clause, /\b(?:i|we)\s+(?:followed up with|reached out to|contacted|texted|emailed|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s*(?:,|and|&)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})*)/giu, "contacted");
		pushMatches(clause, /(?:我|我们)(?:认识了|遇到了|碰到了|见到了|结识了)\s*([\p{Script=Han}]{2,10}(?:\s*(?:和|跟|、)\s*[\p{Script=Han}]{2,10})*)/gu, "met");
		pushMatches(clause, /(?:跟|和)\s*([\p{Script=Han}]{2,10}(?:\s*(?:和|跟|、)\s*[\p{Script=Han}]{2,10})*)\s*(?:交换了联系方式|互留了电话|互留了联系方式)/gu, "exchanged_numbers_with");
		pushMatches(clause, /(?:我|我们)(?:后来|之后|又|再)?(?:联系|约|找|回复|回访)(?:了)?\s*([\p{Script=Han}]{2,10}(?:\s*(?:和|跟|、)\s*[\p{Script=Han}]{2,10})*)/gu, "contacted");
	}
	return results;
}
function parseRelation(text) {
	const stripped = stripLead(text);
	const social = extractSocialRelations(stripped);
	if (social.length > 0) return social[0] ?? null;
	const clauseCandidates = [stripped, ...stripped.split(/[，,；;。]/u).flatMap((part) => part.split(/[：:]/u)).map((part) => trimCapturedValue(part)).filter(Boolean)].filter((entry, index, all) => all.indexOf(entry) === index).slice(0, 8);
	const anchoredPatterns = [
		{
			regex: /^(.+?)\s+(?:indirectly\s+)?depends on\s+(.+)$/iu,
			predicate: "depends_on"
		},
		{
			regex: /^(.+?)\s+uses\s+(.+)$/iu,
			predicate: "uses"
		},
		{
			regex: /^(.+?)\s+reads(?: from)?\s+(.+)$/iu,
			predicate: "uses",
			rawPredicate: "reads"
		},
		{
			regex: /^(.+?)\s+causes\s+(.+)$/iu,
			predicate: "caused_by",
			rawPredicate: "causes",
			swap: true
		},
		{
			regex: /^(.+?)\s+led to\s+(.+)$/iu,
			predicate: "caused_by",
			rawPredicate: "led_to",
			swap: true
		},
		{
			regex: /^(.+?)\s+caused by\s+(.+)$/iu,
			predicate: "caused_by"
		},
		{
			regex: /^(.+?)\s+blocks\s+(.+)$/iu,
			predicate: "blocks"
		},
		{
			regex: /^(.+?)\s+is blocked by\s+(.+)$/iu,
			predicate: "blocks",
			rawPredicate: "blocked_by",
			swap: true
		},
		{
			regex: /^(.+?)\s+part of\s+(.+)$/iu,
			predicate: "part_of"
		},
		{
			regex: /^(.+?)\s+owns\s+(.+)$/iu,
			predicate: "owner_of"
		},
		{
			regex: /^(.+?)\s+is owned by\s+(.+)$/iu,
			predicate: "owner_of",
			rawPredicate: "owned_by",
			swap: true
		},
		{
			regex: /^(.+?)\s+supersedes\s+(.+)$/iu,
			predicate: "supersedes"
		},
		{
			regex: /^(.+?)\s+replaces\s+(.+)$/iu,
			predicate: "supersedes",
			rawPredicate: "replaces"
		},
		{
			regex: /^(.+?)\s+contradicts\s+(.+)$/iu,
			predicate: "contradicts"
		},
		{
			regex: /^(.+?)\s+omits?\s+(.+)$/iu,
			predicate: "contradicts",
			rawPredicate: "omits"
		},
		{
			regex: /^(.+?)\s+conflicts with\s+(.+)$/iu,
			predicate: "contradicts",
			rawPredicate: "conflicts_with"
		},
		{
			regex: /^(.+?)\s+resolved by\s+(.+)$/iu,
			predicate: "resolved_by"
		},
		{
			regex: /^(.+?)\s+resolved with\s+(.+)$/iu,
			predicate: "resolved_by",
			rawPredicate: "resolved_with"
		},
		{
			regex: /^(.+?)\s+(?:was\s+)?corrected\s+by\s+(.+)$/iu,
			predicate: "resolved_by",
			rawPredicate: "corrected_by"
		},
		{
			regex: /^(.+?)\s+(?:was\s+)?fixed\s+by\s+(.+)$/iu,
			predicate: "resolved_by",
			rawPredicate: "fixed_by"
		},
		{
			regex: /^(.+?)\s+related to\s+(.+)$/iu,
			predicate: "related_to"
		},
		{
			regex: /^(.+?)\s*导致(?:了)?\s*(.+)$/u,
			predicate: "caused_by",
			rawPredicate: "causes",
			swap: true
		},
		{
			regex: /^因为\s*(.+?)\s*(?:所以|而|因此)\s*(.+)$/u,
			predicate: "caused_by",
			rawPredicate: "because_of",
			swap: true
		},
		{
			regex: /^(.+?)\s*依赖(?:于)?\s*(.+)$/u,
			predicate: "depends_on"
		},
		{
			regex: /^(.+?)\s*使用\s*(.+)$/u,
			predicate: "uses"
		},
		{
			regex: /^(.+?)\s*读取\s*(.+)$/u,
			predicate: "uses",
			rawPredicate: "reads"
		},
		{
			regex: /^(.+?)\s*由\s*(.+?)\s*导致$/u,
			predicate: "caused_by"
		},
		{
			regex: /^(.+?)\s*阻塞\s*(.+)$/u,
			predicate: "blocks"
		},
		{
			regex: /^(.+?)\s*被\s*(.+?)\s*阻塞$/u,
			predicate: "blocks",
			rawPredicate: "blocked_by",
			swap: true
		},
		{
			regex: /^(.+?)\s*属于\s*(.+)$/u,
			predicate: "part_of"
		},
		{
			regex: /^(.+?)\s*拥有\s*(.+)$/u,
			predicate: "owner_of"
		},
		{
			regex: /^(.+?)\s*被\s*(.+?)\s*拥有$/u,
			predicate: "owner_of",
			rawPredicate: "owned_by",
			swap: true
		},
		{
			regex: /^(.+?)\s*取代\s*(.+)$/u,
			predicate: "supersedes"
		},
		{
			regex: /^(.+?)\s*(?:和|与)\s*(.+?)\s*矛盾$/u,
			predicate: "contradicts"
		},
		{
			regex: /^(.+?)\s*漏掉(?:了)?\s*(.+)$/u,
			predicate: "contradicts",
			rawPredicate: "omits"
		},
		{
			regex: /^(.+?)\s*少了\s*(.+)$/u,
			predicate: "contradicts",
			rawPredicate: "omits"
		},
		{
			regex: /^(.+?)\s*由\s*(.+?)\s*解决$/u,
			predicate: "resolved_by"
		},
		{
			regex: /^(.+?)\s*(?:和|与)\s*(.+?)\s*相关$/u,
			predicate: "related_to"
		},
		{
			regex: /^(.+?)\s+(?:was\s+)?(?:switched|migrated|moved|changed)\s+(?:from\s+)?(.+?)\s+to\s+(.+)$/iu,
			predicate: "supersedes",
			rawPredicate: "migrated_to",
			tripleCapture: true
		},
		{
			regex: /^(?:switched|migrated|moved|changed)\s+(?:from\s+)?(.+?)\s+to\s+(.+)$/iu,
			predicate: "supersedes",
			rawPredicate: "migrated_to",
			swap: false,
			reverseNewOld: true
		}
	];
	const migrationPatterns = [
		{
			regex: /(?:把|将)\s*(.+?)\s*(?:换成|切换到|替换为|迁移到|改[为成])\s*(.+?)(?:[了啦啊呀。，,;；]|$)/u,
			predicate: "supersedes",
			rawPredicate: "migrated_to"
		},
		{
			regex: /(?:从|由)\s*(.+?)\s*(?:换成|切换到|迁移到|改[为成]|升级到|转到)\s*(.+?)(?:[了啦啊呀。，,;；]|$)/u,
			predicate: "supersedes",
			rawPredicate: "migrated_to"
		},
		{
			regex: /(.+?)\s*(?:已(?:经)?)?(?:淘汰|弃用|废弃|停用).*?(?:改用|换用|替换为|迁移到)\s*(.+?)(?:[了啦啊呀。，,;；]|$)/u,
			predicate: "supersedes",
			rawPredicate: "deprecated_for"
		}
	];
	const embeddedPatterns = [{
		regex: /把\s*(.+?)\s*(?:误)?当成\s*(.+?)(?:那一步|了|啦|啊|呀|$)/u,
		predicate: "contradicts",
		rawPredicate: "mistaken_for"
	}, {
		regex: /(.+?)\s*(?:还)?把\s*(.+?)\s*漏掉(?:了)?$/u,
		predicate: "contradicts",
		rawPredicate: "omits"
	}];
	for (const clause of clauseCandidates) {
		for (const pattern of migrationPatterns) {
			const match = clause.match(pattern.regex);
			const oldThing = trimCapturedValue(match?.[1] ?? "");
			const newThing = trimCapturedValue(match?.[2] ?? "");
			if (oldThing && newThing) return {
				subject: newThing,
				predicate: pattern.predicate,
				object: oldThing,
				rawPredicate: pattern.rawPredicate
			};
		}
		for (const pattern of embeddedPatterns) {
			const match = clause.match(pattern.regex);
			let subject = trimCapturedValue(match?.[1] ?? "");
			let object = trimCapturedValue(match?.[2] ?? "");
			if (pattern.swap) [subject, object] = [object, subject];
			if (subject && object) return {
				subject,
				predicate: pattern.predicate,
				object,
				rawPredicate: pattern.rawPredicate
			};
		}
		for (const pattern of anchoredPatterns) {
			const match = clause.match(pattern.regex);
			if (!match) continue;
			let subject;
			let object;
			if (pattern.tripleCapture) {
				subject = trimCapturedValue(match[3] ?? "");
				object = trimCapturedValue(match[2] ?? "");
			} else if (pattern.reverseNewOld) {
				subject = trimCapturedValue(match[2] ?? "");
				object = trimCapturedValue(match[1] ?? "");
			} else {
				subject = trimCapturedValue(match[1] ?? "");
				object = trimCapturedValue(match[2] ?? "");
				if (pattern.swap) [subject, object] = [object, subject];
			}
			if (subject && object) return {
				subject,
				predicate: pattern.predicate,
				object,
				rawPredicate: pattern.rawPredicate
			};
		}
	}
	return null;
}
/**
* Extract ALL relations from text (not just the first match).
* Returns an array of parsed relations. Used by Fix-9 multi-relation extraction.
*/
function parseAllRelations(text) {
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	const relationFallbackSkipPattern = /(?:不是|而不是|而是|先检查|再检查|最后|回头|顺序|步骤|流程|策略|最近两次|验证过)/iu;
	for (const relation of extractSocialRelations(text)) pushUniqueRelation(results, seen, relation);
	pushUniqueRelation(results, seen, parseRelation(text));
	const clauses = stripLead(text).split(/[，,；;。]/u).flatMap((part) => part.split(/[：:]/u)).map((part) => trimCapturedValue(part)).filter(Boolean);
	for (const clause of clauses) {
		if (clause.length < 8 || relationFallbackSkipPattern.test(clause)) continue;
		for (const relation of extractSocialRelations(clause)) pushUniqueRelation(results, seen, relation);
		pushUniqueRelation(results, seen, parseRelation(clause));
	}
	return results.slice(0, 8);
}
function inferEntityNames(text) {
	const allRelations = parseAllRelations(text);
	const results = /* @__PURE__ */ new Map();
	for (const relation of allRelations) {
		const subjectName = relation.subject;
		if (isValidEntityName(subjectName)) results.set(normalizeName(subjectName), {
			name: subjectName,
			type: inferEntityType(subjectName, relation.predicate)
		});
		const objectName = relation.object;
		if (isValidEntityName(objectName)) results.set(normalizeName(objectName), {
			name: objectName,
			type: inferEntityType(objectName, relation.predicate)
		});
	}
	for (const tagged of taggedEntityMatches(text)) if (isValidEntityName(tagged.name)) {
		const key = normalizeName(tagged.name);
		if (!results.has(key)) results.set(key, {
			name: tagged.name,
			type: tagged.tagType
		});
	}
	for (const match of quotedEntityMatches(text)) if (isValidEntityName(match)) {
		const key = normalizeName(match);
		if (!results.has(key)) results.set(key, {
			name: match,
			type: inferEntityType(match)
		});
	}
	for (const match of latinEntityMatches(text)) if (isValidEntityName(match)) {
		const key = normalizeName(match);
		if (!results.has(key)) results.set(key, {
			name: match,
			type: inferEntityType(match)
		});
	}
	return [...results.values()].slice(0, 12);
}
function collectCandidateAnchorNames(query) {
	const names = /* @__PURE__ */ new Map();
	const pushName = (value) => {
		if (!isValidEntityName(value)) return;
		const key = normalizeName(value);
		if (!key || names.has(key)) return;
		names.set(key, value.trim());
	};
	const relation = parseRelation(query);
	if (relation) {
		pushName(relation.subject);
		pushName(relation.object);
	}
	for (const tagged of taggedEntityMatches(query)) pushName(tagged.name);
	for (const match of quotedEntityMatches(query)) pushName(match);
	for (const match of latinEntityMatches(query)) pushName(match);
	for (const entry of inferEntityNames(query)) pushName(entry.name);
	return [...names.values()];
}
function anchorSpecificity(name) {
	const normalized = normalizeText(name);
	if (!normalized) return 0;
	const tokens = normalizedTerms(name, {
		minLength: 1,
		includeCjkSubwords: false
	});
	const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, "");
	const containsLatin = /[a-z]/u.test(normalized);
	const containsDigit = /\d/u.test(normalized);
	return Math.min(.52, compact.length / 18) + Math.min(.2, tokens.length * .06) + (containsLatin ? .14 : 0) + (containsDigit ? .06 : 0);
}
function singleAnchorSupport(text, anchor) {
	const normalizedText = normalizeText(text);
	const normalizedAnchor = normalizeText(anchor);
	if (!normalizedText || !normalizedAnchor) return 0;
	const compactText = normalizeName(text).replace(/[^\p{L}\p{N}]+/gu, "");
	const compactAnchor = normalizeName(anchor).replace(/[^\p{L}\p{N}]+/gu, "");
	if (normalizedText === normalizedAnchor || compactText === compactAnchor) return 1;
	if (compactAnchor.length >= 3 && compactText.includes(compactAnchor) && !QUESTION_LIKE_PATTERNS.some((pattern) => pattern.test(anchor))) return .96;
	const anchorTokens = tokenizeSearchTerms(anchor, /* @__PURE__ */ new Set());
	const textTokens = tokenizeSearchTerms(text, /* @__PURE__ */ new Set());
	if (anchorTokens.length === 0 || textTokens.length === 0) return 0;
	let overlap = 0;
	for (const token of anchorTokens) if (textTokens.includes(token)) overlap += 1;
	const recall = overlap / Math.max(anchorTokens.length, 1);
	return recall >= 1 ? .92 : recall * .88;
}
function extractQueryAnchors(query) {
	return collectCandidateAnchorNames(query).sort((left, right) => anchorSpecificity(right) - anchorSpecificity(left)).slice(0, 6);
}
function queryAnchorSupport(text, anchors) {
	if (anchors.length === 0) return 0;
	return anchors.reduce((best, anchor) => Math.max(best, singleAnchorSupport(text, anchor)), 0);
}
function seedEntityNamesFromQuery(query) {
	return extractQueryAnchors(query).slice(0, 8);
}
function expandStateKeyAliases(key) {
	return [...STATE_KEY_ALIASES[canonicalStateKey(key)] ?? [key]];
}
function canonicalStateKey(key) {
	for (const [canonical, aliases] of Object.entries(STATE_KEY_ALIASES)) if (aliases.includes(key)) return canonical;
	return key;
}
function wantsHistoricalFacts(query) {
	if (/(?:change over time|changed over time|how did my .* change|did my .* change over time)/iu.test(query)) return true;
	if (!HISTORICAL_CORRECTION_PATTERN.test(query)) return false;
	return prototypeSimilarity(query, [
		"did my preference change over time",
		"what did I prefer before",
		"历史上偏好变过吗",
		"之前是什么",
		"以前是什么",
		"曾经偏好什么"
	]) >= .2;
}
function wantsCurrentFactualSnapshot(query) {
	if (/(?:我现在在做什么|我刚才在做什么|当前任务|下一步|blocker|卡点|卡在哪|working on|next step|what am i doing|what was i doing)/iu.test(query)) return false;
	if (wantsProjectProfileSnapshot(query)) return true;
	if (!/(?:现在|当前|目前|仍然|有效|结论|still|current|final|latest)/iu.test(query)) return false;
	if (/(?:现在仍然有效|当前有效|目前有效|仍然有效的信息|现在有哪些有效|最终结论|现有结论|当前结论|现在用的什么|当前用的什么|当前技术栈|still valid|still true|current valid|current info|final conclusion|current conclusion)/iu.test(query)) return true;
	return prototypeSimilarity(query, [
		"what current information is still valid",
		"what is still true about this project",
		"what is the final conclusion now",
		"当前仍然有效的信息有哪些",
		"现在仍然有效的信息有哪些",
		"最终结论是什么",
		"现在这个项目用的是什么"
	]) >= .34;
}
function inferCorrectionTargetKind(params) {
	if (params.canonicalKey?.startsWith("project.")) return "project_profile";
	if (params.canonicalKey) return "state";
	if (params.predicate && new Set([
		"uses_async_framework",
		"uses_primary_language",
		"uses_cache",
		"has_launch_date",
		"has_historical_alias",
		"has_product_name"
	]).has(params.predicate)) return "project_profile";
	if (params.predicate === "relation") return "relation";
	if (params.predicate) return "fact";
	if (/(?:版本|组件|技术栈|stack|component|version|launch date|发布日期|上线时间)/iu.test(params.text)) return "project_profile";
	return "unknown";
}
function inferCorrectionPredicate(text) {
	if (/(?:异步任务|异步作业|job system|queue|worker|temporal|celery)/iu.test(text)) return "uses_async_framework";
	if (/(?:主服务|主程序|service|backend|语言|runtime|python|go|java|node)/iu.test(text)) return "uses_primary_language";
	if (/(?:缓存|cache|redis|memcached)/iu.test(text)) return "uses_cache";
	if (/(?:公测|上线|上线时间|launch|正式发布|试运行|内测|beta|ga)/iu.test(text)) return "has_launch_date";
	if (/(?:代号|别名|旧称|旧名|内部名|codename|alias)/iu.test(text)) return "has_historical_alias";
	if (/(?:产品名|名称|当前名称|现在叫|名叫|命名|product name)/iu.test(text)) return "has_product_name";
}
function analyzeCorrectionHint(params) {
	const text = stripLead(params.text);
	if (!text) return null;
	const switched = text.match(/(?:从|from)\s*(.+?)\s*(?:改成|换成|迁移到|切到|变成|to)\s*(.+?)(?:[，,。.;；]|$)/iu);
	const explicitReplacement = text.match(/(?:不是|而不是)\s*(.+?)\s*(?:而是|而在|而为|而用(?:的是)?|而改成|而换成)\s*(.+?)(?:[，,。.;；]|$)/iu);
	const negatedCurrent = text.match(/(.+?)\s*(?:现在|目前|当前)?\s*(?:不是|不再是|已经不是|not|no longer)\s*(.+?)(?:[，,。.;；]|$)/iu);
	const currentValue = text.match(/(?:现在|目前|当前).{0,12}(?:是|为|用的是|改成|换成|set to|is|are|uses?)\s*(.+?)(?:[，,。.;；]|$)/iu);
	const explicitCurrentVsPast = text.match(/(?:真正|正式|实际|当前有效|目前有效).{0,12}(?:是|为|在)\s*(.+?)(?:[，,。.;；]|(?:不是|而不是)|$)/iu);
	const explicitPrior = text.match(/(?:不是|而不是)\s*(.+?)(?:[，,。.;；]|$)/iu);
	const explicitCurrentAuthority = /(?:才是当前|才是现在|才算当前|应该理解成|视为历史|保留为历史|不能默认|不要当成当前|不能被说成|别把.+当成|现已不用|已经不用)/iu.test(text);
	const compareTimeframe = COMPARISON_CORRECTION_PATTERN.test(text);
	const currentTimeframe = CURRENT_CORRECTION_PATTERN.test(text);
	const historicalTimeframe = HISTORICAL_CORRECTION_PATTERN.test(text);
	const timeCorrectionTimeframe = /(?:不是|而不是)/u.test(text) && extractTimeHints(text).length >= 1 && /(今年|去年|前年|this year|last year|next year|公测|试运行|内测|上线)/iu.test(text);
	const hasChangeCue = Boolean(explicitReplacement || switched || negatedCurrent || explicitPrior) || Boolean(explicitCurrentVsPast && (explicitPrior || timeCorrectionTimeframe || compareTimeframe)) || explicitCurrentAuthority || CHANGE_OPERATOR_PATTERN.test(text);
	const summaryRestatementOnly = SUMMARY_REQUEST_PATTERN.test(text) && !explicitCurrentAuthority && !switched && !negatedCurrent && !explicitCurrentVsPast && !explicitPrior;
	if (!hasChangeCue || summaryRestatementOnly) return null;
	const timeframe = compareTimeframe ? "compare" : explicitReplacement || explicitCurrentAuthority ? "current" : currentTimeframe ? "current" : historicalTimeframe ? "historical" : timeCorrectionTimeframe ? "compare" : null;
	if (!timeframe) return null;
	const priorValue = trimCapturedValue(explicitReplacement?.[1] ?? switched?.[1] ?? negatedCurrent?.[2] ?? explicitPrior?.[1] ?? "");
	const rawNextValue = trimCapturedValue(explicitReplacement?.[2] ?? switched?.[2] ?? currentValue?.[1] ?? explicitCurrentVsPast?.[1] ?? "");
	const nextValue = priorValue && rawNextValue && normalizeText(priorValue) === normalizeText(rawNextValue) ? "" : rawNextValue;
	const predicate = params.predicate ?? (/关系|认识|见过|met|contacted|introduced/iu.test(text) ? "relation" : inferCorrectionPredicate(text));
	const canonicalKey = params.canonicalKey;
	return {
		timeframe,
		targetKind: inferCorrectionTargetKind({
			text,
			canonicalKey,
			predicate
		}),
		...priorValue ? { priorValue } : {},
		...nextValue ? { nextValue } : {},
		...canonicalKey ? { canonicalKey } : {},
		...predicate ? { predicate } : {},
		confidence: timeframe === "compare" ? .78 : .72,
		reason: "current/historical correction cue"
	};
}
function analyzeRecallQueryShape(query) {
	const anchors = extractQueryAnchors(query);
	const currentCue = wantsCurrentFactualSnapshot(query) || CURRENT_SNAPSHOT_QUERY_PATTERN.test(query) || /(?:当前配置|当前设定|当前状态|现在仍然有效的设定|现在仍然有效的信息|当前有哪些|目前有哪些|哪些仍然有效)/iu.test(query);
	const historical = HISTORICAL_QUERY_PATTERN.test(query) || wantsHistoricalFacts(query) || isBroadTemporalQuery(query);
	const current = currentCue && !historical;
	const explicitCompare = /(?:不该当成当前|不要当成当前|哪些.*历史信息|哪些.*当前配置|当前和历史|历史和当前|区分当前和历史|still valid vs history|current vs history)/iu.test(query);
	const timeframe = COMPARISON_CORRECTION_PATTERN.test(query) || explicitCompare || (current || historical) && /(?:与当前区分|区分当前和历史|不是当前|而不是当前|still valid|current vs history)/iu.test(query) ? "compare" : historical && !current ? "historical" : current ? "current" : historical ? "historical" : "timeless";
	const granularity = EXACT_DETAIL_QUERY_PATTERN.test(query) ? "exact_detail" : "summary";
	const referentialMode = anchors.length > 0 || !DEICTIC_QUERY_PATTERN.test(query) ? "anchored" : "deictic";
	let evidenceNeed = "canonical_state";
	if (isDeicticWorkflowReferenceQuery(query) || WORKFLOW_CONTEXT_QUERY_PATTERN.test(query)) evidenceNeed = "workflow_context";
	else if (ALIAS_RESOLUTION_QUERY_PATTERN.test(query)) evidenceNeed = "relation";
	else if (/(?:关系|依赖|related|relationship|depends?|dependency|met|认识|谁)/iu.test(query)) evidenceNeed = /(?:met|认识|谁)/iu.test(query) ? "relation" : "relation";
	else if (timeframe === "historical" || timeframe === "compare") evidenceNeed = /(?:发生|时间线|history|timeline|event|后来|公测|上线|时间|什么时候|哪次|最早|历史信息|旧称|别名|代号)/iu.test(query) ? "event_history" : "factual_history";
	else if (timeframe === "current") evidenceNeed = current ? "canonical_state" : evidenceNeed;
	else if (SUMMARY_REQUEST_PATTERN.test(query)) evidenceNeed = "chunk";
	else if (granularity === "exact_detail") evidenceNeed = "chunk";
	return {
		timeframe,
		granularity,
		referentialMode,
		evidenceNeed
	};
}
function wantsProjectProfileSnapshot(query) {
	if (!PROJECT_PROFILE_FACT_PATTERN.test(query)) return false;
	if (HISTORICAL_PROJECT_PROFILE_PATTERN.test(query)) return false;
	return true;
}
function isDeicticWorkflowReferenceQuery(query) {
	return WORKFLOW_DEICTIC_REFERENCE_PATTERN.test(query);
}
function isBroadTemporalQuery(query) {
	if (!/(?:happened|recent|history|historical|timeline|event|events|before|after|earlier|previous|old|发生|最近|历史|事件|时间线|之前|以前|后来|当时|曾经|旧版|最早)/iu.test(query)) return false;
	return prototypeSimilarity(query, [
		"what happened",
		"recent events",
		"history timeline",
		"发生了什么",
		"有哪些事件",
		"还有什么事件",
		"最近发生了什么",
		"我之前有过什么其它事件吗",
		"我之前在这个插件开发里遇到过哪些问题",
		"后来怎么解决的"
	]) >= .22;
}
function predicateHint(query) {
	const relation = parseRelation(query);
	if (relation) return relation.predicate;
	if (/(?:block|blocked|阻塞|卡住)/iu.test(query)) return "blocks";
	if (/(?:depend|dependency|依赖)/iu.test(query)) return "depends_on";
	if (/(?:cause|caused by|原因|导致)/iu.test(query)) return "caused_by";
	if (/(?:resolve|resolved|解决)/iu.test(query)) return "resolved_by";
	if (/(?:contradict|conflict|矛盾|冲突)/iu.test(query)) return "contradicts";
	if (/(?:supersede|replace|取代|替代)/iu.test(query)) return "supersedes";
	if (/(?:owner|owns|owned by|负责人|拥有)/iu.test(query)) return "owner_of";
	if (matchesAny(query, CONSTRAINT_QUERY_PATTERNS)) return "constraint";
	if (prototypeSimilarity(query, [
		"language preference",
		"prefer English",
		"prefer Chinese",
		"双语偏好",
		"语言偏好"
	]) >= .45 || /(?:英文|中文|双语|english|chinese|bilingual)/iu.test(query)) return "prefers_language";
}
function semanticRoleHint(text) {
	const normalized = normalizeText(text);
	if (prototypeSimilarity(normalized, [
		"I prefer bilingual answers",
		"我更喜欢双语回答",
		"默认中文回答"
	]) >= .35) return "user_profile";
	if (prototypeSimilarity(normalized, [
		"I am working on",
		"current task",
		"我现在在做",
		"下一步要做"
	]) >= .35) return "workflow";
	if (parseRelation(text)) return "relation";
	if (prototypeSimilarity(normalized, [
		"what happened recently",
		"之前遇到过哪些问题",
		"发生了什么"
	]) >= .35) return "temporal";
	return "unknown";
}
function normalizedEntityId(name, type = "unknown") {
	return `${normalizeName(name)}:${type}`;
}
//#endregion
export { analyzeCorrectionHint, analyzeRecallQueryShape, canonicalStateKey, cleanProjectName, expandStateKeyAliases, extractQueryAnchors, extractTimeHints, hasExplicitRememberIntent, inferEntityNames, inferEntityType, isBroadTemporalQuery, isDeicticWorkflowReferenceQuery, isLowValueChatter, isQuestionLike, looksLikeBareInstructionalGuidance, looksLikeBareMemoryUseInstruction, looksLikeProjectDescriptor, normalizeGraphRelationType, normalizedEntityId, parseAllRelations, parseRelation, predicateHint, prototypeSimilarity, queryAnchorSupport, seedEntityNamesFromQuery, semanticRoleHint, stripLead, tokenizeSearchTerms, trimCapturedValue, wantsCurrentFactualSnapshot, wantsHistoricalFacts, wantsProjectProfileSnapshot };
