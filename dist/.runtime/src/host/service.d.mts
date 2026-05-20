import { MemxTurnEnvelope } from "./hookPayload.mjs";
import { MemoryPluginConfig, MemxLogger } from "../types.mjs";

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
};
declare function createServiceConfigFromEnv(env?: NodeJS.ProcessEnv): MemoryPluginConfig;
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
export { MemxHostService, MemxRecallRequest, MemxServiceOptions, createServiceConfigFromEnv, stableHostTurnId };