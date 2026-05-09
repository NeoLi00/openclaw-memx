import { normalizeName } from "../support.js";
// These are generic descriptor nouns used to strip presentation-only tails
// from project references. They are alias normalization hints, not a closed
// ontology of allowed project types.
const LATIN_PROJECT_HEADWORDS = new Set([
    "adapter",
    "app",
    "core",
    "library",
    "module",
    "package",
    "platform",
    "plugin",
    "project",
    "repo",
    "repository",
    "service",
    "system",
    "workspace",
]);
const HAN_PROJECT_HEADWORDS = [
    "应用",
    "平台",
    "插件",
    "服务",
    "模块",
    "系统",
    "项目",
    "仓库",
    "适配器",
    "内核",
    "包",
    "库",
    "工作区",
];
const LATIN_DESCRIPTOR_SEPARATOR_RE = /^(.*?)[/:._ -]+([a-z]+)$/iu;
const HAN_DESCRIPTOR_SEPARATOR_RE = /^(.*?)[/:._ -]+([\p{Script=Han}]{2,8})$/u;
function isLatinProjectHeadword(value) {
    return LATIN_PROJECT_HEADWORDS.has(value.toLowerCase());
}
function stripProjectDescriptorTail(value, options = {}) {
    const allowLatinDescriptorTail = options.allowLatinDescriptorTail ?? true;
    const allowHanDescriptorTail = options.allowHanDescriptorTail ?? true;
    const normalized = normalizeName(value).replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }
    if (allowLatinDescriptorTail) {
        const parts = normalized.split(" ").filter(Boolean);
        if (parts.length > 1) {
            const reducedParts = [...parts];
            while (reducedParts.length > 1 && isLatinProjectHeadword(reducedParts.at(-1))) {
                reducedParts.pop();
            }
            if (reducedParts.length !== parts.length) {
                return reducedParts.join(" ");
            }
        }
    }
    const compact = normalized.replace(/\s+/g, "");
    if (allowHanDescriptorTail) {
        const mixedHanSuffix = compact.match(/^([a-z0-9_.-]{2,}?)([\p{Script=Han}]{2,8})$/iu);
        if (mixedHanSuffix &&
            HAN_PROJECT_HEADWORDS.some((suffix) => mixedHanSuffix[2].endsWith(suffix))) {
            return mixedHanSuffix[1];
        }
    }
    if (allowLatinDescriptorTail) {
        const separatedLatinTail = normalized.match(LATIN_DESCRIPTOR_SEPARATOR_RE);
        if (separatedLatinTail && isLatinProjectHeadword(separatedLatinTail[2])) {
            const stem = separatedLatinTail[1].trim();
            if (stem.length >= 3) {
                return stem;
            }
        }
    }
    if (allowHanDescriptorTail) {
        const separatedHanTail = normalized.match(HAN_DESCRIPTOR_SEPARATOR_RE);
        if (separatedHanTail &&
            HAN_PROJECT_HEADWORDS.some((suffix) => separatedHanTail[2].endsWith(suffix))) {
            const stem = separatedHanTail[1].trim();
            if (stem.length >= 2) {
                return stem;
            }
        }
        const hanTail = HAN_PROJECT_HEADWORDS.find((suffix) => compact.endsWith(suffix));
        if (hanTail && /^[\p{Script=Han}]+$/u.test(compact)) {
            const stem = compact.slice(0, -hanTail.length).trim();
            if (stem.length >= 2) {
                return stem;
            }
        }
    }
    return normalized;
}
function compactProjectIdentity(value, options = {}) {
    const reduced = stripProjectDescriptorTail(value, options);
    const base = reduced || normalizeName(value);
    return base.replace(/\s+/g, "");
}
function buildProjectAliasVariants(value, options) {
    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }
    const normalized = normalizeName(trimmed);
    const reduced = stripProjectDescriptorTail(trimmed, options);
    const compact = normalized.replace(/\s+/g, "");
    const reducedCompact = reduced.replace(/\s+/g, "");
    return [...new Set([trimmed, normalized, compact, reduced, reducedCompact].filter(Boolean))];
}
function projectAliasEquivalent(left, right) {
    const leftAliases = new Set(buildProjectAliasVariants(left, {
        allowLatinDescriptorTail: true,
        allowHanDescriptorTail: true,
    }).map((entry) => projectIdentityKey(entry)));
    const rightAliases = new Set(buildProjectAliasVariants(right, {
        allowLatinDescriptorTail: true,
        allowHanDescriptorTail: true,
    }).map((entry) => projectIdentityKey(entry)));
    for (const alias of leftAliases) {
        if (alias && rightAliases.has(alias)) {
            return true;
        }
    }
    return false;
}
export function projectIdentityKey(value) {
    return compactProjectIdentity(value.trim(), {
        allowLatinDescriptorTail: true,
        allowHanDescriptorTail: true,
    });
}
export function projectNamesMatch(left, right) {
    if (!left.trim() || !right.trim()) {
        return false;
    }
    return projectIdentityKey(left) === projectIdentityKey(right);
}
export function looksLikeProjectDescriptor(value) {
    const normalized = normalizeName(value.trim()).replace(/\s+/g, " ");
    if (!normalized) {
        return false;
    }
    if (isLatinProjectHeadword(normalized)) {
        return true;
    }
    if (HAN_PROJECT_HEADWORDS.includes(normalized)) {
        return true;
    }
    const compact = normalized.replace(/\s+/g, "");
    return ([...LATIN_PROJECT_HEADWORDS].some((suffix) => compact.toLowerCase() === suffix) ||
        HAN_PROJECT_HEADWORDS.some((suffix) => compact === suffix));
}
export function projectAliasVariants(value) {
    return buildProjectAliasVariants(value, {
        allowLatinDescriptorTail: true,
        allowHanDescriptorTail: true,
    });
}
export function resolveProjectReference(value, params) {
    const trimmed = value.trim();
    if (!trimmed) {
        return trimmed;
    }
    const knownProjects = [
        ...new Set((params.knownProjects ?? []).map((entry) => entry.trim()).filter(Boolean)),
    ];
    const exact = knownProjects.find((entry) => projectNamesMatch(entry, trimmed));
    if (exact) {
        return exact;
    }
    const currentProject = params.currentProject?.trim();
    if (currentProject && projectNamesMatch(currentProject, trimmed)) {
        return currentProject;
    }
    if (params.allowDescriptorAlias) {
        if (currentProject && projectAliasEquivalent(currentProject, trimmed)) {
            return currentProject;
        }
        if (knownProjects.length === 1 && projectAliasEquivalent(knownProjects[0], trimmed)) {
            return knownProjects[0];
        }
        if (currentProject && looksLikeProjectDescriptor(trimmed)) {
            return currentProject;
        }
        if (knownProjects.length === 1 && looksLikeProjectDescriptor(trimmed)) {
            return knownProjects[0];
        }
    }
    return trimmed;
}
export function isProjectProfileStateKey(key) {
    return key.startsWith("project.") && key !== "project.active_project";
}
export function projectCodeFromStateKey(key) {
    if (!isProjectProfileStateKey(key)) {
        return undefined;
    }
    const code = key.slice("project.".length).trim();
    return code || undefined;
}
