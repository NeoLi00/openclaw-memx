import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import plugin from "../dist/index.mjs";
import { captureAgentEndTurn } from "../dist/src/pipeline/turnCapture.mjs";
import { stripInjectedHistoricalBlock } from "../dist/src/security/escaping.mjs";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

test("memory recall registers only the prompt-build hook plus agent_end capture", async () => {
  const hooks = [];

  await plugin.register({
    config: {},
    pluginConfig: {},
    logger: createLogger(),
    registerTool() {},
    registerCli() {},
    on(name) {
      hooks.push(name);
    },
    registerService() {},
  });

  assert.equal(hooks.filter((name) => name === "before_prompt_build").length, 1);
  assert.equal(hooks.filter((name) => name === "before_agent_start").length, 0);
  assert.equal(hooks.filter((name) => name === "agent_end").length, 1);
});

test("MemX prepend context markers are stripped before reading the user query", () => {
  const prompt = [
    "<!-- MEMX_CONTEXT_START -->",
    "## MemX Memory",
    "- remembered historical fact",
    "<!-- MEMX_CONTEXT_END -->",
    "",
    "What should I do next?",
  ].join("\n");

  assert.equal(stripInjectedHistoricalBlock(prompt), "What should I do next?");
});

test("turn capture excludes MemX prepend context from the captured user message", () => {
  const prompt = [
    "<!-- MEMX_CONTEXT_START -->",
    "## MemX Memory",
    "- previous answer evidence",
    "<!-- MEMX_CONTEXT_END -->",
    "",
    "Please continue the current task.",
  ].join("\n");

  const captured = captureAgentEndTurn({
    agentId: "main",
    scope: "global",
    sessionKey: "agent:main:test",
    turnId: "turn_test",
    observedAt: "2026-05-11T00:00:00.000Z",
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: "Continuing the task." },
    ],
  });

  assert.deepEqual(
    captured.map((entry) => ({ role: entry.role, content: entry.content })),
    [
      { role: "user", content: "Please continue the current task." },
      { role: "assistant", content: "Continuing the task." },
    ],
  );
});

test("compiled recall hook returns prependContext rather than overriding systemPrompt", async () => {
  const compiled = await readFile(new URL("../dist/src/index.mjs", import.meta.url), "utf8");

  assert.match(compiled, /prependContext:\s*_logPromptContext/);
  assert.doesNotMatch(compiled, /systemPrompt:\s*_logSystemPrompt/);
});
