import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("OpenClaw quickstart config wires DeepSeek LLM and default local embedding", async () => {
  const { applyOpenClawQuickstartConfig } = await import("../dist/src/host/quickstart.mjs");

  const next = applyOpenClawQuickstartConfig(
    { agents: { defaults: { models: { "openai/gpt-5.4": { alias: "GPT" } } } } },
    { apiKey: "sk-test" },
  );

  assert.equal(next.models.providers.deepseek.baseUrl, "https://api.deepseek.com");
  assert.equal(next.models.providers.deepseek.apiKey, "sk-test");
  assert.equal(next.agents.defaults.model.primary, "deepseek/deepseek-v4-pro");
  assert.equal(next.agents.defaults.models["deepseek/deepseek-v4-pro"].alias, "DeepSeek V4 Pro");
  assert.equal(next.agents.defaults.models["deepseek/deepseek-v4-flash"].alias, "DeepSeek V4 Flash");

  const memx = next.plugins.entries["memory-memx"].config;
  assert.equal(memx.advanced.llmClassifierEnabled, true);
  assert.equal(memx.advanced.llmClassifierModel, "deepseek/deepseek-v4-flash");
  assert.equal(memx.advanced.enableCompatibilityMemoryTools, false);
  assert.equal(memx.embedding.provider, "sentence-transformers-local");
  assert.equal(memx.embedding.model, "intfloat/multilingual-e5-small");
  assert.match(memx.embedding.localPythonBin, /\.openclaw\/memx\/\.venv\/bin\/python$/);
});

test("OpenClaw quickstart can store provider key as an env SecretRef", async () => {
  const { applyOpenClawQuickstartConfig } = await import("../dist/src/host/quickstart.mjs");

  const next = applyOpenClawQuickstartConfig({}, { apiKeyEnv: "DEEPSEEK_API_KEY" });

  assert.deepEqual(next.models.providers.deepseek.apiKey, {
    source: "env",
    provider: "default",
    id: "DEEPSEEK_API_KEY",
  });
});

test("OpenClaw quickstart command plan is exec-form only", async () => {
  const { buildOpenClawQuickstartSteps } = await import("../dist/src/host/quickstart.mjs");

  const steps = buildOpenClawQuickstartSteps({
    apiKey: "sk-test",
    homeDir: "/tmp/home",
    configPath: "/tmp/openclaw.json",
  });

  assert.deepEqual(
    steps.map((step) => [step.command, step.args]),
    [
      ["python3", ["-m", "venv", "/tmp/home/.openclaw/memx/.venv"]],
      [
        "/tmp/home/.openclaw/memx/.venv/bin/python",
        ["-m", "pip", "install", "-U", "pip", "sentence-transformers", "torch"],
      ],
      ["openclaw", ["plugins", "install", "@neoli00/memory-memx"]],
      ["openclaw", ["gateway", "restart"]],
      ["openclaw", ["memx", "doctor", "--deep"]],
    ],
  );
  for (const step of steps) {
    assert.equal(typeof step.command, "string");
    assert.ok(Array.isArray(step.args));
    assert.doesNotMatch(step.command, /\s/);
  }
});

test("OpenClaw quickstart writes config and redacts plaintext API key from result", async () => {
  const { runOpenClawQuickstart } = await import("../dist/src/host/quickstart.mjs");
  const dir = mkdtempSync(join(tmpdir(), "memx-quickstart-"));
  const configPath = join(dir, "openclaw.json");
  const calls = [];

  const result = await runOpenClawQuickstart(
    {
      apiKey: "sk-secret",
      configPath,
      homeDir: dir,
      skipEmbeddingDeps: true,
      skipRestart: true,
      skipDoctor: true,
    },
    {
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  );

  assert.deepEqual(calls, [
    { command: "openclaw", args: ["plugins", "install", "@neoli00/memory-memx"] },
  ]);
  assert.equal(existsSync(configPath), true);
  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.models.providers.deepseek.apiKey, "sk-secret");
  assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
  assert.equal(result.ok, true);
});
