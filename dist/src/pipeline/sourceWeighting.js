import { clamp01, normalizeText, truncateText } from "../support.js";
import { semanticTextSimilarity } from "./semantic/textSimilarity.js";
export function contentStructuralComplexity(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return 0;
    }
    const lineCount = trimmed.split(/\r?\n/u).length;
    const bulletCount = (trimmed.match(/^\s*(?:[-*•]|\d+\.)\s+/gmu) ?? []).length;
    const fileMentionCount = (trimmed.match(/\b[\p{L}\p{N}_./-]+\.(?:ts|js|json|md|sh|sql|txt|yml|yaml|html|css)\b/gu) ?? []).length;
    const hasCodeFence = trimmed.includes("```");
    const hasCommandDensity = /(?:^|\n)\s*(?:pnpm|npm|bun|node|git|sqlite3|openclaw)\b/u.test(trimmed);
    return clamp01((Math.min(trimmed.length, 2400) / 2400) * 0.34 +
        (Math.min(lineCount, 40) / 40) * 0.16 +
        (Math.min(bulletCount, 12) / 12) * 0.12 +
        (Math.min(fileMentionCount, 8) / 8) * 0.08 +
        (hasCodeFence ? 0.18 : 0) +
        (hasCommandDensity ? 0.12 : 0));
}
function surroundingSupportText(chunks, index) {
    return chunks
        .filter((_, chunkIndex) => Math.abs(chunkIndex - index) <= 2 && chunkIndex !== index)
        .filter((chunk) => chunk.role !== "assistant")
        .map((chunk) => chunk.content)
        .join("\n")
        .trim();
}
function nearestToolDistance(chunks, index) {
    let bestDistance = null;
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        if (chunks[chunkIndex]?.role !== "tool") {
            continue;
        }
        const distance = Math.abs(chunkIndex - index);
        if (bestDistance === null || distance < bestDistance) {
            bestDistance = distance;
        }
    }
    return bestDistance;
}
export function assessAssistantChunk(chunk, taskChunks) {
    if (chunk.role !== "assistant") {
        return {
            weight: 1,
            grounding: 1,
            complexity: contentStructuralComplexity(chunk.content),
            useSummaryOnly: false,
        };
    }
    const index = taskChunks.findIndex((entry) => entry.chunkId === chunk.chunkId);
    const supportText = index >= 0 ? surroundingSupportText(taskChunks, index) : "";
    const grounding = supportText
        ? Math.max(semanticTextSimilarity(chunk.summary || chunk.content, supportText), semanticTextSimilarity(chunk.content, supportText))
        : 0;
    const complexity = contentStructuralComplexity(chunk.content);
    const trimmed = chunk.content.trim();
    const lineCount = trimmed ? trimmed.split(/\r?\n/u).length : 0;
    const toolDistance = index >= 0 ? nearestToolDistance(taskChunks, index) : null;
    const toolSupport = toolDistance === null ? 0 : toolDistance <= 1 ? 0.16 : toolDistance <= 2 ? 0.08 : 0;
    const longTutorialPenalty = toolDistance === null && trimmed.length > 900 && lineCount > 10 && complexity > 0.56 ? 0.18 : 0;
    const conciseAssistantBonus = trimmed.length > 0 && trimmed.length <= 360 && lineCount <= 5 && complexity <= 0.38 ? 0.24 : 0;
    const weight = clamp01(0.28 +
        grounding * 0.46 +
        toolSupport +
        conciseAssistantBonus -
        complexity * 0.28 -
        longTutorialPenalty);
    return {
        weight,
        grounding,
        complexity,
        useSummaryOnly: weight < 0.58 || complexity > 0.68,
    };
}
export function renderTaskPromptChunk(chunk, taskChunks) {
    if (chunk.role !== "assistant") {
        return truncateText(chunk.content, 500);
    }
    const assessment = assessAssistantChunk(chunk, taskChunks);
    if (assessment.weight < 0.38) {
        return "assistant explanatory response (low grounding; use only if corroborated by user or tool evidence)";
    }
    const primary = assessment.useSummaryOnly ? chunk.summary || chunk.content : chunk.content;
    return truncateText(primary, assessment.useSummaryOnly ? 220 : 380);
}
export function filteredGroundedTaskChunks(chunks) {
    return chunks.filter((chunk) => {
        if (chunk.role !== "assistant") {
            return true;
        }
        const assessment = assessAssistantChunk(chunk, chunks);
        const conciseGroundedAssistant = assessment.weight >= 0.5 && assessment.grounding >= 0.18 && assessment.complexity <= 0.42;
        return assessment.weight >= 0.58 || assessment.grounding >= 0.48 || conciseGroundedAssistant;
    });
}
export function assistantVectorText(chunk, taskChunks) {
    if (chunk.role !== "assistant") {
        return truncateText(chunk.content, 500);
    }
    if (taskChunks) {
        const assessment = assessAssistantChunk(chunk, taskChunks);
        if (assessment.weight < 0.38) {
            return truncateText(chunk.summary || "assistant explanatory response", 140);
        }
        if (assessment.useSummaryOnly) {
            return truncateText(chunk.summary || chunk.content, 180);
        }
    }
    const complexity = contentStructuralComplexity(chunk.content);
    if (complexity >= 0.64) {
        return truncateText(chunk.summary || chunk.content, 180);
    }
    return truncateText(chunk.content, 320);
}
export function assistantVectorSummary(chunk, taskChunks) {
    if (chunk.role !== "assistant") {
        return truncateText(chunk.summary || chunk.content, 180);
    }
    if (taskChunks) {
        const assessment = assessAssistantChunk(chunk, taskChunks);
        if (assessment.weight < 0.38) {
            return "assistant explanatory response";
        }
        if (assessment.useSummaryOnly) {
            return truncateText(chunk.summary || "assistant response", 140);
        }
    }
    return truncateText(chunk.summary || chunk.content, 180);
}
export function isProjectNameMatch(name, projectCode) {
    if (!projectCode?.trim()) {
        return false;
    }
    return normalizeText(name) === normalizeText(projectCode);
}
