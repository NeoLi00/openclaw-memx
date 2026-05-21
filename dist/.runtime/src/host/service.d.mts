import { MemxTurnEnvelope } from "./hookPayload.mjs";
import { EvidenceBundle, MemoryPluginConfig, MemxLogger, QueryCompileResult } from "../types.mjs";

//#region src/host/service.d.ts
type MemxServiceOptions = {
  config?: MemoryPluginConfig;
  logger?: MemxLogger;
};
type MemxRecallRequest = {
  query: string;
  limit?: number;
  hostId?: string;
  actorId?: string;
  sessionId?: string;
  workspaceDir?: string;
  project?: string;
  hotPathTimeoutMs?: number;
};
declare function createServiceConfigFromEnv(env?: NodeJS.ProcessEnv): MemoryPluginConfig;
type NativeContextEligibility = {
  eligible: boolean;
  reason: string;
  bestScore: number;
};
declare function focusRecallBundleForQueryEntities(queryAnalysis: Pick<QueryCompileResult, "queryEntities">, bundle: EvidenceBundle): EvidenceBundle;
declare function assessNativeContextEligibility(_query: string, queryAnalysis: QueryCompileResult, bundle: EvidenceBundle): NativeContextEligibility;
declare class MemxHostService {
  private readonly config;
  private readonly logger;
  private readonly manager;
  constructor(options?: MemxServiceOptions);
  close(): Promise<void>;
  observe(input: unknown): Promise<Record<string, unknown>>;
  recall(request: MemxRecallRequest): Promise<Record<string, unknown>>;
  remember(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  forget(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  stats(): Promise<Record<string, unknown>>;
  audit(limit?: number): Promise<Record<string, unknown>>;
  context(request: MemxRecallRequest): Promise<Record<string, unknown>>;
}
declare function stableHostTurnId(envelope: MemxTurnEnvelope): string;
//#endregion
export { MemxHostService, MemxRecallRequest, MemxServiceOptions, assessNativeContextEligibility, createServiceConfigFromEnv, focusRecallBundleForQueryEntities, stableHostTurnId };