import { resolveDefaultScope } from "../security/scopes.js";
import { normalizeText } from "../support.js";
import { classifyAction } from "./classify.js";
import { computeConfidence } from "./normalize.js";
import { evaluatePolicy } from "./policy.js";
export function reflectCandidates(candidates, ctx, options) {
    return reflectCandidatesInternal(candidates, ctx, options);
}
async function reflectCandidatesInternal(candidates, ctx, options) {
    const eligible = candidates.slice(-ctx.config.reflectionMaxItems).filter((candidate) => {
        if (candidate.source.kind === "assistant")
            return false;
        const trimmed = candidate.rawText.trim();
        return trimmed.length > 0 && trimmed.length <= ctx.config.reflectionMaxChars;
    });
    const results = await Promise.all(eligible.map(async (candidate) => {
        const policyResult = await evaluatePolicy(candidate, ctx, {
            reasoner: options?.reasoner,
        });
        const trimmed = candidate.rawText.trim();
        const classified = {
            ...policyResult.candidate,
            normalizedText: normalizeText(trimmed),
            policy: policyResult.decision,
            scope: resolveDefaultScope(ctx.config, {
                agentId: ctx.agentId,
                sessionKey: ctx.sessionKey,
                project: ctx.project,
                workspace: ctx.workspaceDir,
            }),
            classification: classifyAction(policyResult.decision.action),
            confidence: 0,
        };
        classified.confidence = computeConfidence(classified);
        return classified.classification !== "ignore" ? classified : null;
    }));
    return results.filter((r) => r !== null);
}
