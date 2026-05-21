declare module "openclaw/plugin-sdk/core" {
  type HookActorContext = {
    agentId: string;
    sessionKey?: string;
    workspaceDir?: string;
    channelId?: string;
    runId?: string;
    toolName?: string;
    toolCallId?: string;
    trigger?: string;
    messageProvider?: string;
  };

  export type OpenClawConfig = {
    agents?: {
      list?: Array<{ id?: string }>;
    };
  };

  export type PluginConfigUiHint = {
    label?: string;
    help?: string;
    tags?: string[];
    advanced?: boolean;
    sensitive?: boolean;
    placeholder?: string;
  };

  export type OpenClawPluginConfigSchema = {
    safeParse?: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: {
        issues?: Array<{ path: Array<string | number>; message: string }>;
      };
    };
    parse?: (value: unknown) => unknown;
    validate?: (value: unknown) => unknown;
    uiHints?: Record<string, PluginConfigUiHint>;
    jsonSchema?: Record<string, unknown>;
  };

  export type AnyAgentTool = {
    name: string;
    label?: string;
    description?: string;
    parameters?: unknown;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown> | unknown;
  };

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    source: string;
    registrationMode?: string;
    config: OpenClawConfig;
    pluginConfig?: unknown;
    runtime: unknown;
    logger: {
      debug?: (message: string) => void;
      info: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
    };
    registerTool: (
      toolFactory: (ctx: {
        agentId?: string;
        sessionKey?: string;
        workspaceDir?: string;
      }) => AnyAgentTool | AnyAgentTool[] | null | undefined,
      opts?: { name?: string; names?: string[]; optional?: boolean },
    ) => void;
    registerCli: (
      register: (ctx: { program: import("commander").Command }) => void,
      opts?: { commands?: string[] },
    ) => void;
    registerService: (entry: {
      id: string;
      start?: (...args: unknown[]) => unknown;
      stop?: (...args: unknown[]) => unknown;
    }) => void;
    on: {
      (
        name: "before_prompt_build",
        handler: (
          event: { prompt: string; messages: unknown[] },
          ctx: HookActorContext,
        ) =>
          | Promise<{
              systemPrompt?: string;
              prependContext?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
              toolPolicyOverride?: {
                allow?: string[];
                deny?: string[];
                reason?: string;
              };
            } | void>
          | {
              systemPrompt?: string;
              prependContext?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
              toolPolicyOverride?: {
                allow?: string[];
                deny?: string[];
                reason?: string;
              };
            }
          | void,
      ): void;
      (
        name: "before_agent_start",
        handler: (
          event: { prompt: string; messages?: unknown[] },
          ctx: HookActorContext,
        ) =>
          | Promise<{
              systemPrompt?: string;
              prependContext?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
              modelOverride?: string;
              providerOverride?: string;
            } | void>
          | {
              systemPrompt?: string;
              prependContext?: string;
              prependSystemContext?: string;
              appendSystemContext?: string;
              modelOverride?: string;
              providerOverride?: string;
            }
          | void,
      ): void;
      (
        name: "agent_end",
        handler: (
          event: { messages: unknown[]; success: boolean },
          ctx: HookActorContext,
        ) => Promise<void> | void,
      ): void;
      (
        name: "message_received",
        handler: (
          event: {
            content: string;
            timestamp?: string | number | Date;
            metadata?: Record<string, unknown>;
          },
          ctx: HookActorContext,
        ) => Promise<void> | void,
      ): void;
      (
        name: "tool_result_persist",
        handler: (event: { message: unknown }, ctx: HookActorContext) => Promise<void> | void,
      ): void;
      (
        name: "after_tool_call",
        handler: (
          event: {
            toolName: string;
            toolCallId?: string;
            runId?: string;
            params: Record<string, unknown>;
            result?: unknown;
            error?: string;
            durationMs?: number;
          },
          ctx: HookActorContext,
        ) => Promise<void> | void,
      ): void;
      (name: string, handler: (...args: unknown[]) => unknown): void;
    };
  };

  export type OpenClawPluginDefinition = {
    id: string;
    name: string;
    description: string;
    kind?: "memory" | "context-engine";
    configSchema?: OpenClawPluginConfigSchema;
    register?: (api: OpenClawPluginApi) => void;
  };

  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    kind?: OpenClawPluginDefinition["kind"];
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    register: (api: OpenClawPluginApi) => void;
  }): OpenClawPluginDefinition & {
    configSchema: OpenClawPluginConfigSchema;
    register: (api: OpenClawPluginApi) => void;
  };
}
