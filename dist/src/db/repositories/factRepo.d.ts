import type { NormalizedFact } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class FactRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    static predicateAllowsCoexistingFacts(predicate: string): boolean;
    static predicateCoexistsAcrossObjects(predicate: string): boolean;
    get(factId: string): NormalizedFact | null;
    supersedeActiveBySubjectAndPredicate(params: {
        agentId: string;
        scope: string;
        canonicalSubject: string;
        predicate: string;
        updatedAt: string;
        sourceRef: string;
        changeReason: string;
    }): number;
    /**
     * Extract the canonical verb prefix from a predicate.
     * Returns the verb if the first underscore-delimited token is in
     * `ALLOWED_VERB_PREFIXES`, otherwise null (legacy or unstructured predicates).
     * `prefers_code_style` → `"prefers"`, `follows_coding_style` → null
     */
    static predicateVerb(predicate: string): string | null;
    /**
     * Extract the topic portion of a predicate by stripping the leading verb prefix.
     * Both canonical (`ALLOWED_VERB_PREFIXES`) and legacy verbs are stripped.
     * Remaining underscores are converted to spaces.
     * `prefers_code_style` → `"code style"`, `follows_coding_style` → `"coding style"`.
     */
    static predicateTopic(predicate: string): string;
    findBySemanticKey(params: {
        agentId: string;
        scope: string;
        canonicalSubject: string;
        predicate: string;
        includeHistorical?: boolean;
    }): NormalizedFact[];
    findActiveBySemanticKey(params: {
        agentId: string;
        scope: string;
        canonicalSubject: string;
        predicate: string;
    }): NormalizedFact[];
    findActiveBySubject(params: {
        agentId: string;
        scope: string;
        canonicalSubject: string;
    }): NormalizedFact[];
    upsert(fact: NormalizedFact, changeReason: string): {
        action: "created" | "updated" | "versioned";
    };
    query(params: {
        agentId: string;
        scopes: string[];
        text?: string;
        predicate?: string;
        limit?: number;
        includeHistorical?: boolean;
        readEpoch?: number;
    }): NormalizedFact[];
    markDeleted(params: {
        agentId: string;
        scope?: string;
        factId?: string;
        subject?: string;
    }): number;
    private toFact;
}
