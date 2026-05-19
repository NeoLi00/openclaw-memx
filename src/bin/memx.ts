#!/usr/bin/env node

function usage(): string {
  return [
    "Usage: memx <command>",
    "",
    "Commands:",
    "  server              Start the local MemX REST service",
    "  mcp                 Start the MemX MCP stdio server",
    "  hook <host> <event>  Run a native hook bridge",
    "  quickstart openclaw Configure OpenClaw, MemX LLM, and local embeddings",
    "  connect codex       Wire Codex MCP config",
    "  connect claude-code Wire Claude Code MCP config",
  ].join("\n");
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseOpenClawQuickstartOptions(argv: string[]) {
  const embeddingProvider = readOption(argv, "--embedding-provider");
  return {
    preset: readOption(argv, "--preset") as "deepseek" | "custom" | undefined,
    providerId: readOption(argv, "--provider-id"),
    baseUrl: readOption(argv, "--base-url"),
    apiKey: readOption(argv, "--api-key"),
    apiKeyEnv: readOption(argv, "--api-key-env"),
    agentModel: readOption(argv, "--agent-model"),
    memxModel: readOption(argv, "--memx-model"),
    embeddingProvider: embeddingProvider as
      | "local"
      | "off"
      | "openai-compatible"
      | "ollama"
      | "sentence-transformers-local"
      | undefined,
    embeddingModel: readOption(argv, "--embedding-model"),
    embeddingPythonBin: readOption(argv, "--embedding-python"),
    embeddingCacheDir: readOption(argv, "--embedding-cache-dir"),
    embeddingDevice: readOption(argv, "--embedding-device") as
      | "auto"
      | "cpu"
      | "mps"
      | "cuda"
      | undefined,
    configPath: readOption(argv, "--config"),
    openclawBin: readOption(argv, "--openclaw-bin"),
    pythonBin: readOption(argv, "--python"),
    skipEmbeddingDeps:
      hasFlag(argv, "--skip-embedding-deps") || hasFlag(argv, "--no-install-embedding-deps"),
    skipPluginInstall: hasFlag(argv, "--skip-plugin-install"),
    skipRestart: hasFlag(argv, "--skip-restart"),
    skipDoctor: hasFlag(argv, "--skip-doctor"),
    dryRun: hasFlag(argv, "--dry-run"),
  };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "server") {
    const { startMemxHttpServer } = await import("../host/httpServer.js");
    await startMemxHttpServer();
    return;
  }
  if (command === "mcp") {
    const { startMcpStdio } = await import("../host/mcpStdio.js");
    await startMcpStdio();
    return;
  }
  if (command === "hook") {
    const { runMemxHook } = await import("../host/hookRunner.js");
    await runMemxHook(argv.slice(1));
    return;
  }
  if (command === "quickstart") {
    const target = argv[1];
    if (target === "openclaw") {
      const { runOpenClawQuickstart } = await import("../host/quickstart.js");
      const result = await runOpenClawQuickstart(parseOpenClawQuickstartOptions(argv.slice(2)));
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    throw new Error(`unknown quickstart target: ${target ?? ""}`);
  }
  if (command === "connect") {
    const { connectClaudeCodeConfig, connectCodexConfig } = await import("../host/connect.js");
    const target = argv[1];
    if (target === "codex") {
      console.log(`Wired Codex: ${connectCodexConfig()}`);
      return;
    }
    if (target === "claude-code" || target === "claude") {
      console.log(`Wired Claude Code: ${connectClaudeCodeConfig()}`);
      return;
    }
    throw new Error(`unknown connect target: ${target ?? ""}`);
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
