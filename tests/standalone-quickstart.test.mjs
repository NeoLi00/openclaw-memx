import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("standalone quickstart builds independent LLM and local embedding config", async () => {
  const { applyStandaloneMemxQuickstartConfig } = await import(
    "../dist/.runtime/src/host/standaloneQuickstart.mjs"
  );

  const next = applyStandaloneMemxQuickstartConfig(
    {},
    {
      llmProvider: "openai-compatible",
      llmBaseUrl: "https://llm.example.com/v1",
      llmModel: "fast-memory-model",
      llmApiKey: "sk-standalone",
      homeDir: "/tmp/home",
    },
  );

  assert.equal(next.advanced.llmProvider, "openai-compatible");
  assert.equal(next.advanced.llmBaseURL, "https://llm.example.com/v1");
  assert.equal(next.advanced.llmClassifierModel, "fast-memory-model");
  assert.equal(next.advanced.llmApiKey, "sk-standalone");
  assert.equal(next.embedding.provider, "sentence-transformers-local");
  assert.equal(next.embedding.model, "intfloat/multilingual-e5-small");
  assert.equal(next.embedding.localPythonBin, "/tmp/home/.memx/.venv/bin/python");
});

test("standalone service config resolves LLM without OpenClaw config", async () => {
  const { runStandaloneMemxQuickstart } = await import("../dist/.runtime/src/host/standaloneQuickstart.mjs");
  const { createServiceConfigFromEnv } = await import("../dist/.runtime/src/host/service.mjs");
  const { loadJudgeModelConfig } = await import("../dist/.runtime/src/pipeline/judgeModelConfig.mjs");
  const dir = mkdtempSync(join(tmpdir(), "memx-standalone-"));
  const configPath = join(dir, "config.json");

  await runStandaloneMemxQuickstart({
    target: "mcp",
    configPath,
    homeDir: dir,
    llmProvider: "openai-compatible",
    llmBaseUrl: "https://llm.example.com/v1",
    llmModel: "fast-memory-model",
    llmApiKey: "sk-standalone",
    skipEmbeddingDeps: true,
  });

  const config = createServiceConfigFromEnv({ MEMX_CONFIG_PATH: configPath });
  const judge = loadJudgeModelConfig(config, { debug() {}, warn() {} });

  assert.equal(judge.provider, "openai-compatible");
  assert.equal(judge.baseUrl, "https://llm.example.com/v1");
  assert.equal(judge.model, "fast-memory-model");
  assert.equal(judge.apiKey, "sk-standalone");
});

test("standalone quickstart can configure Codex in one command", async () => {
  const { runStandaloneMemxQuickstart } = await import("../dist/.runtime/src/host/standaloneQuickstart.mjs");
  const dir = mkdtempSync(join(tmpdir(), "memx-codex-"));
  const configPath = join(dir, "config.json");
  const codexConfigPath = join(dir, "codex.toml");

  const result = await runStandaloneMemxQuickstart({
    target: "codex",
    configPath,
    codexConfigPath,
    homeDir: dir,
    llmProvider: "openai-compatible",
    llmBaseUrl: "https://llm.example.com/v1",
    llmModel: "fast-memory-model",
    llmApiKey: "sk-standalone",
    skipEmbeddingDeps: true,
  });

  assert.equal(existsSync(configPath), true);
  assert.equal(existsSync(codexConfigPath), true);
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.advanced.llmBaseURL, "https://llm.example.com/v1");
  assert.equal(written.embedding.model, "intfloat/multilingual-e5-small");
  const toml = readFileSync(codexConfigPath, "utf8");
  assert.match(toml, /\[mcp_servers\.memx\]/);
  assert.match(toml, /MEMX_URL = "http:\/\/127\.0\.0\.1:3878"/);
  assert.doesNotMatch(JSON.stringify(result), /sk-standalone/);
});

test("standalone quickstart local embedding install plan is exec-form only", async () => {
  const { buildStandaloneMemxQuickstartSteps } = await import(
    "../dist/.runtime/src/host/standaloneQuickstart.mjs"
  );

  const steps = buildStandaloneMemxQuickstartSteps({
    target: "mcp",
    homeDir: "/tmp/home",
    llmProvider: "openai-compatible",
    llmBaseUrl: "https://llm.example.com/v1",
    llmModel: "fast-memory-model",
    llmApiKey: "sk-standalone",
  });

  assert.deepEqual(
    steps.map((step) => [step.command, step.args]),
    [
      ["python3", ["-m", "venv", "/tmp/home/.memx/.venv"]],
      [
        "/tmp/home/.memx/.venv/bin/python",
        ["-m", "pip", "install", "-U", "pip", "sentence-transformers", "torch"],
      ],
    ],
  );
  for (const step of steps) {
    assert.equal(typeof step.command, "string");
    assert.ok(Array.isArray(step.args));
    assert.doesNotMatch(step.command, /\s/);
  }
});

test("standalone quickstart dry run shows no API key for local Ollama", async () => {
  const { runStandaloneMemxQuickstart } = await import("../dist/.runtime/src/host/standaloneQuickstart.mjs");

  const result = await runStandaloneMemxQuickstart({
    target: "mcp",
    llmProvider: "ollama",
    llmBaseUrl: "http://127.0.0.1:11434",
    llmModel: "qwen2.5:7b",
    skipEmbeddingDeps: true,
    dryRun: true,
  });

  assert.equal(result.llmApiKey, null);
});
