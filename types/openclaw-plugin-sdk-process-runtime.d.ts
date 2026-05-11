declare module "openclaw/plugin-sdk/process-runtime" {
  export type SpawnResult = {
    pid?: number;
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    killed: boolean;
    termination: "exit" | "timeout" | "no-output-timeout" | "signal";
    noOutputTimedOut?: boolean;
  };

  export type CommandOptions = {
    timeoutMs: number;
    cwd?: string;
    input?: string;
    env?: NodeJS.ProcessEnv;
    windowsVerbatimArguments?: boolean;
    noOutputTimeoutMs?: number;
  };

  export function runCommandWithTimeout(
    argv: string[],
    optionsOrTimeout: number | CommandOptions,
  ): Promise<SpawnResult>;
}
