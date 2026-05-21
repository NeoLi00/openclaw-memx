import assert from "node:assert/strict";
import test from "node:test";

function row(id, text) {
  return {
    id,
    text,
    score: 0.9,
    scope: "agent:test",
    observedAt: "2026-05-21T00:00:00.000Z",
  };
}

function packet(packetId, text, entityAliases = []) {
  return {
    packetId,
    slotId: `${packetId}-slot`,
    operationType: "return_value",
    role: "answer",
    injected: true,
    primaryText: text,
    supportingTexts: [],
    sourceRefs: [`fact:${packetId}`],
    entityAliases,
    coverage: { filled: true, missing: [], confidence: 0.9 },
    grade: {
      retrievalScore: 0.9,
      answerScore: 0.9,
      contextBindingScore: 0.9,
      slotCoverageScore: 0.9,
      authorityScore: 0.9,
      finalScore: 0.9,
    },
  };
}

test("native recall context can focus injected evidence on LLM query entities", async () => {
  const { focusRecallBundleForQueryEntities } = await import(
    "../dist/.runtime/src/host/service.mjs"
  );
  assert.equal(typeof focusRecallBundleForQueryEntities, "function");

  const bundle = {
    routeType: "mixed",
    routeConfidence: 0.9,
    states: [row("state-redmap", "RedMapNotebook 默认队列是 NATS")],
    tasks: [],
    facts: [
      row("fact-claude", "ClaudeProbe 默认输出格式是 Parquet"),
      row("fact-redmap", "RedMapNotebook 默认输出格式是 SQLite"),
    ],
    events: [
      row("event-claude", "用户在 ClaudeProbe 任务里确认了 Parquet"),
      row("event-redmap", "用户在 RedMapNotebook 任务里讨论了 DigestQueue"),
    ],
    graph: {
      nodes: [],
      edges: [],
      pathCandidates: [],
      paths: [
        "ClaudeProbe -> default format -> Parquet",
        "RedMapNotebook -> default queue -> NATS",
      ],
    },
    alternates: [],
    diagnostics: [],
    behavioralGuidance: [
      "ClaudeProbe 相关问题优先回答 Parquet。",
      "RedMapNotebook 相关问题优先检查 DigestQueue。",
    ],
    recalledChunkIds: [],
    recalledChunkTexts: [],
    promptEvidence: [],
    evidencePackets: [
      packet("packet-claude", "ClaudeProbe 默认输出格式是 Parquet", ["ClaudeProbe"]),
      packet("packet-redmap", "RedMapNotebook 默认输出格式是 SQLite", ["RedMapNotebook"]),
    ],
    renderedBlock: "",
  };
  const focused = focusRecallBundleForQueryEntities(
    {
      queryEntities: [{ name: "ClaudeProbe", type: "project", role: "subject" }],
      suppressedEntities: [],
    },
    bundle,
  );

  assert.deepEqual(
    focused.facts.map((entry) => entry.id),
    ["fact-claude"],
  );
  assert.deepEqual(
    focused.events.map((entry) => entry.id),
    ["event-claude"],
  );
  assert.deepEqual(
    focused.states.map((entry) => entry.id),
    [],
  );
  assert.deepEqual(focused.graph.paths, ["ClaudeProbe -> default format -> Parquet"]);
  assert.deepEqual(focused.behavioralGuidance, ["ClaudeProbe 相关问题优先回答 Parquet。"]);
  assert.deepEqual(
    focused.evidencePackets.map((entry) => entry.packetId),
    ["packet-claude"],
  );
});

test("native recall context trusts source-grounded assembled evidence", async () => {
  const { assessNativeContextEligibility } = await import("../dist/.runtime/src/host/service.mjs");

  const result = assessNativeContextEligibility(
    "上次确认的默认数据库是什么？",
    {
      queryEntities: [],
      suppressedEntities: [],
    },
    {
      routeType: "mixed",
      routeConfidence: 0.32,
      states: [],
      tasks: [],
      facts: [],
      events: [],
      graph: { nodes: [], edges: [], pathCandidates: [], paths: [] },
      alternates: [],
      diagnostics: [],
      behavioralGuidance: [],
      recalledChunkIds: [],
      recalledChunkTexts: [],
      promptEvidence: [],
      evidencePackets: [
        {
          ...packet("packet-db", "InvoicePilot 默认数据库是 PostgreSQL"),
          coverage: { filled: false, missing: ["query_context"], confidence: 0.44 },
          grade: {
            retrievalScore: 0.48,
            answerScore: 0.45,
            contextBindingScore: 0.36,
            slotCoverageScore: 0.42,
            authorityScore: 0.7,
            finalScore: 0.42,
          },
          displayLines: ["[answer] InvoicePilot 默认数据库是 PostgreSQL"],
          sourceRefs: ["chunk:user:turn-1:0"],
        },
      ],
      renderedBlock: "[answer] InvoicePilot 默认数据库是 PostgreSQL",
    },
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "assembled-source-evidence");
});

test("native recall context can inject direct facts when packet assembly is sparse", async () => {
  const { assessNativeContextEligibility } = await import("../dist/.runtime/src/host/service.mjs");

  const result = assessNativeContextEligibility(
    "AuroraAccept 现在默认数据库、告警渠道和导出格式分别是什么？",
    {
      queryEntities: [],
      suppressedEntities: [],
    },
    {
      routeType: "mixed",
      routeConfidence: 0.22,
      states: [],
      tasks: [],
      facts: [
        row("fact-db", "AuroraAccept 默认数据库是 PostgreSQL"),
        row("fact-channel", "AuroraAccept 告警渠道是 Slack"),
      ],
      events: [],
      graph: { nodes: [], edges: [], pathCandidates: [], paths: [] },
      alternates: [],
      diagnostics: [],
      behavioralGuidance: [],
      recalledChunkIds: [],
      recalledChunkTexts: [],
      promptEvidence: [],
      evidencePackets: [],
      renderedBlock: "AuroraAccept 默认数据库是 PostgreSQL",
    },
  );

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "direct-structured-evidence");
});
