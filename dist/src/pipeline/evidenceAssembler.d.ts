import type { EvidencePacket, EvidencePacketAudit, PromptEvidenceCandidate, QueryCompileResult } from "../types.js";
import type { CandidateGenerationResult } from "./candidateGeneration.js";
export type EvidenceAssemblerInput = {
    queryAnalysis: QueryCompileResult;
    candidateGenerationResult?: CandidateGenerationResult;
    promptEvidence: PromptEvidenceCandidate[];
    now?: string;
};
export type EvidenceAssemblerResult = {
    packets: EvidencePacket[];
    promptEvidence: PromptEvidenceCandidate[];
    audit?: EvidencePacketAudit;
};
export declare function assembleEvidencePackets(input: EvidenceAssemblerInput): EvidenceAssemblerResult;
