import type { OpenClawPluginConfigSchema, PluginConfigUiHint } from "openclaw/plugin-sdk/core";
import { type MemoryPluginConfig } from "./types.js";
export declare const DEFAULT_MEMORY_CONFIG: MemoryPluginConfig;
export declare const memxConfigSchema: OpenClawPluginConfigSchema;
export declare const memxConfigJsonSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        enabled: {
            type: string;
        };
        dbPath: {
            type: string;
        };
        autoCapture: {
            type: string;
        };
        autoRecall: {
            type: string;
        };
        reflectionEnabled: {
            type: string;
        };
        consentMode: {
            type: string;
            enum: ("off" | "explicit" | "implicit")[];
        };
        maxInjectedChars: {
            type: string;
            minimum: number;
            maximum: number;
        };
        captureMaxChars: {
            type: string;
            minimum: number;
            maximum: number;
        };
        reflectionMaxChars: {
            type: string;
            minimum: number;
            maximum: number;
        };
        reflectionMaxItems: {
            type: string;
            minimum: number;
            maximum: number;
        };
        piiMode: {
            type: string;
            enum: ("off" | "redact" | "allow")[];
        };
        defaultScope: {
            type: string;
        };
        allowedScopes: {
            type: string;
            items: {
                type: string;
            };
        };
        minSalienceDurable: {
            type: string;
            minimum: number;
            maximum: number;
        };
        minSalienceSession: {
            type: string;
            minimum: number;
            maximum: number;
        };
        minUtilityForGraph: {
            type: string;
            minimum: number;
            maximum: number;
        };
        maxSensitivityAllowed: {
            type: string;
            minimum: number;
            maximum: number;
        };
        stateTtlHours: {
            type: string;
            minimum: number;
            maximum: number;
        };
        episodicDedupWindowDays: {
            type: string;
            minimum: number;
            maximum: number;
        };
        graphMaxHops: {
            type: string;
            minimum: number;
            maximum: number;
        };
        maxGraphNodes: {
            type: string;
            minimum: number;
            maximum: number;
        };
        maxGraphEdges: {
            type: string;
            minimum: number;
            maximum: number;
        };
        embedding: {
            type: string;
            additionalProperties: boolean;
            properties: {
                provider: {
                    type: string;
                    enum: ("off" | "openai-compatible" | "ollama" | "sentence-transformers-local")[];
                };
                baseURL: {
                    type: string;
                };
                apiKey: {
                    type: string;
                };
                model: {
                    type: string;
                };
                dimensions: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                headers: {
                    type: string;
                    additionalProperties: {
                        type: string;
                    };
                };
                ollamaBaseURL: {
                    type: string;
                };
                ollamaModel: {
                    type: string;
                };
                localPythonBin: {
                    type: string;
                };
                localCacheDir: {
                    type: string;
                };
                localDevice: {
                    type: string;
                    enum: string[];
                };
            };
        };
        advanced: {
            type: string;
            additionalProperties: boolean;
            properties: {
                llmClassifierEnabled: {
                    type: string;
                };
                llmClassifierModel: {
                    type: string;
                };
                enableMaintenanceJobs: {
                    type: string;
                };
                maintenanceTriggerMode: {
                    type: string;
                    enum: string[];
                };
                maintenanceBatchTurns: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                maintenanceIdleFlushMinutes: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                enableGraphPromotion: {
                    type: string;
                };
                enableFactPromotion: {
                    type: string;
                };
                enableTelemetryAudit: {
                    type: string;
                };
                enableExplicitRecallTool: {
                    type: string;
                };
                suggestExplicitRecallTool: {
                    type: string;
                };
                enableCompatibilityMemoryTools: {
                    type: string;
                };
                enableTurnScheduler: {
                    type: string;
                };
                enableTurnSemanticCompiler: {
                    type: string;
                };
                enableQueryCompiler: {
                    type: string;
                };
                enableEmbeddingCandidates: {
                    type: string;
                };
                enableEmbeddingClustering: {
                    type: string;
                };
                enableHotPathChunkSummaryLlm: {
                    type: string;
                };
                enableHotPathTaskSummaryLlm: {
                    type: string;
                };
                candidateSurfaceBudgets: {
                    type: string;
                    additionalProperties: boolean;
                    properties: {
                        state: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        fact: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        event: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        task: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        chunk: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        graph: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        entityAlias: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                    };
                };
                chunkDedupThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                taskIdleTimeoutMinutes: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallChunkBudget: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallTotalObjectBudget: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallBackgroundCharReserve: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallPromptBudgetFloor: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallObjectiveMinWeight: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallObjectiveOverflowRatio: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeWorkflowStrongThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeWorkflowContinuationThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeFactualStrongThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeFactualShortQueryThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeHybridStrongThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeHybridModerateThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeEscalateThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                recallProbeContinuationEscalateThreshold: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
            };
        };
    };
};
export declare const memxConfigUiHints: Record<string, PluginConfigUiHint>;
