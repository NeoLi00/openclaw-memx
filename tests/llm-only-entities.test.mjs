import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidate } from "../dist/src/pipeline/extract.mjs";
import {
  buildQueryCompilerPromptInput,
  compileQuery,
  compileQueryWithoutSemanticFallback,
} from "../dist/src/pipeline/queryCompiler.mjs";
import { normalizeCandidate } from "../dist/src/pipeline/normalize.mjs";
import { MemxReasoner } from "../dist/src/pipeline/reasoner.mjs";
import * as semantics from "../dist/src/pipeline/semantics.mjs";
import {
  buildLongTurnSemanticScanInputFromSegments,
  buildTurnSemanticCompilerInput,
  compileTurnSemantics,
  frameHintsForSourceRef,
} from "../dist/src/pipeline/turnSemanticCompiler.mjs";

const observedAt = "2026-05-12T00:00:00.000Z";

function minimalConfig() {
  return {
    captureMaxChars: 4000,
    advanced: {
      enableTurnSemanticCompiler: true,
      enableQueryCompiler: true,
    },
  };
}

function minimalCtx() {
  return {
    agentId: "main",
    scope: "agent:main",
    scopes: ["agent:main"],
    now: observedAt,
    config: minimalConfig(),
  };
}

test("candidate extraction does not create deterministic semantic hints", () => {
  const candidate = buildCandidate({
    sourceKind: "user",
    rawText: '记住：我喜欢中文。明天继续 project OpenClaw uses "DeepSeek" for e_p sanity check',
    observedAt,
    config: minimalConfig(),
    source: {
      sessionKey: "s1",
      messageId: "m1",
    },
    eventType: "conversation_turn",
  });

  assert.ok(candidate);
  assert.deepEqual(candidate.structuredHints?.entities, []);
  assert.deepEqual(candidate.structuredHints?.timeHints, []);
  assert.equal(candidate.structuredHints?.preference, undefined);
  assert.equal(candidate.structuredHints?.preferenceHint, undefined);
  assert.equal(candidate.structuredHints?.workflow, undefined);
  assert.equal(candidate.structuredHints?.workflows, undefined);
  assert.equal(candidate.structuredHints?.taskStateHint, undefined);
  assert.equal(candidate.structuredHints?.decision, undefined);
  assert.equal(candidate.structuredHints?.decisionHint, undefined);
  assert.equal(candidate.structuredHints?.correction, undefined);
  assert.equal(candidate.structuredHints?.correctionHint, undefined);
  assert.equal(candidate.structuredHints?.relation, undefined);
  assert.equal(candidate.structuredHints?.relations, undefined);
  assert.equal(candidate.structuredHints?.relationHint, undefined);
});

test("legacy deterministic semantic extractors are not exported", () => {
  for (const name of [
    "inferEntityNames",
    "extractQueryAnchors",
    "seedEntityNamesFromQuery",
    "analyzeSemanticHints",
    "parsePreferenceSignal",
    "parseWorkflowState",
    "analyzeRecallQueryShape",
    "analyzeCorrectionHint",
  ]) {
    assert.equal(name in semantics, false, `${name} should not remain on semantics surface`);
  }
});

test("turn semantic fallback does not synthesize deterministic entity hints or relation drafts", async () => {
  const frame = await compileTurnSemantics({
    messages: [
      {
        role: "user",
        content: 'project OpenClaw uses "DeepSeek" for e_p sanity check',
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn1",
        sourceRef: "user:turn1",
        observedAt,
      },
    ],
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => false,
    },
  });

  assert.ok(frame);
  assert.equal(frame.taskProposal, undefined);
  assert.equal(frame.assertionDrafts.length, 0);
  assert.equal(frame.correctionDrafts.length, 0);
  assert.equal(frame.relationDrafts?.length ?? 0, 0);
  assert.equal(
    frame.assertionDrafts.some((draft) => (draft.entityHints?.length ?? 0) > 0),
    false,
  );
});

test("LLM turn compiler entity hints remain the only entity hint source", async () => {
  const frame = await compileTurnSemantics({
    messages: [
      {
        role: "user",
        content: "DeepSeek should be remembered as the provider for this turn",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn2",
        sourceRef: "user:turn2",
        observedAt,
      },
    ],
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileTurnSemantics: async () => ({
        assertionDrafts: [
          {
            sourceRef: "user:turn2",
            familyHint: "fact_like",
            timeframeHint: "timeless",
            entityHints: [{ name: "DeepSeek", type: "service" }],
            confidence: 0.9,
          },
        ],
      }),
    },
  });

  const hints = frameHintsForSourceRef(frame, "user:turn2");

  assert.deepEqual(hints?.entities, [{ name: "DeepSeek", type: "service" }]);
});

test("turn semantic compiler input compacts long messages without losing the tail", () => {
  const middleMarker = "MIDDLE_ONLY_TURN_MARKER_DO_NOT_LEAK";
  const tailMarker = "TAIL_TURN_RECALL_MARKER";
  const content = `${"head facts ".repeat(220)}\n${middleMarker}\n${"body filler ".repeat(220)}\n${tailMarker}`;

  const input = buildTurnSemanticCompilerInput([
    {
      role: "user",
      content,
      scope: "agent:main",
      sessionKey: "s1",
      turnId: "turn-long-input",
      sourceRef: "user:turn-long-input",
      observedAt,
    },
  ]);
  const serialized = JSON.stringify(input);

  assert.equal(input.messages[0].rawLength, content.length);
  assert.equal(input.messages[0].truncated, true);
  assert.ok(serialized.includes(tailMarker));
  assert.equal(serialized.includes(middleMarker), false);
  assert.equal(serialized.includes(content), false);
});

test("turn semantic compiler receives bounded recent reference context for deictic writes", async () => {
  const chunk = (turnId, seq, role, content, summary = "") => ({
    chunkId: `chunk_${turnId}_${seq}`,
    agentId: "main",
    scope: "agent:main",
    sessionKey: "s1",
    turnId,
    seq,
    role,
    chunkKind: "message",
    content,
    summary,
    contentHash: `hash_${turnId}_${seq}`,
    taskId: "task_1",
    dedupStatus: "active",
    mergeCount: 0,
    sourceRef: `${role}:${turnId}:${seq}`,
    createdAt: observedAt,
    updatedAt: observedAt,
  });

  let capturedReferenceContext;
  const frame = await compileTurnSemantics({
    messages: [
      {
        role: "user",
        content: "那这个就不要再考虑了。",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-current",
        sourceRef: "user:turn-current",
        observedAt,
      },
      {
        role: "assistant",
        content: "好的，后续不再把 Kafka 作为 LuoShu 的 broker 候选。",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-current",
        sourceRef: "assistant:turn-current",
        observedAt,
      },
    ],
    activeChunks: [
      chunk("turn-old", 0, "user", "最早讨论的是 NATS，OLD_CONTEXT_SHOULD_NOT_LEAK。"),
      chunk("turn-old", 1, "assistant", "NATS 是很早之前的候选。"),
      chunk("turn-prev-1", 0, "user", "broker 方案有哪些？"),
      chunk("turn-prev-1", 1, "assistant", "可以比较 RabbitMQ、Kafka、NATS。"),
      chunk("turn-prev-2", 0, "user", "Kafka 的维护成本是不是太高？"),
      chunk("turn-prev-2", 1, "assistant", "Kafka 对 LuoShu broker 来说维护成本偏高。"),
    ],
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileTurnSemantics: async (_messages, fallback) => {
        capturedReferenceContext = fallback.referenceContext;
        return {};
      },
    },
  });

  assert.ok(capturedReferenceContext);
  assert.equal(capturedReferenceContext.purpose, "deictic_reference_resolution");
  assert.deepEqual(
    capturedReferenceContext.turns.map((turn) => turn.turnId),
    ["turn-prev-1", "turn-prev-2"],
  );
  const serializedContext = JSON.stringify(capturedReferenceContext);
  assert.ok(serializedContext.includes("Kafka"));
  assert.equal(serializedContext.includes("OLD_CONTEXT_SHOULD_NOT_LEAK"), false);
  assert.ok(serializedContext.length < 2400);

  const input = buildTurnSemanticCompilerInput(
    [
      {
        role: "user",
        content: "那这个就不要再考虑了。",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-current",
        sourceRef: "user:turn-current",
        observedAt,
      },
    ],
    capturedReferenceContext,
  );
  assert.deepEqual(input.recentReferenceContext, capturedReferenceContext);
  assert.deepEqual(frame.referenceContext, capturedReferenceContext);
});

test("long turn semantic scan is deferred out of the hot path", async () => {
  const middleMarker = "MEMORY_MEMX_WRITE_MIDDLE_ENTITY_ANCHOR";
  const content = `${"alpha ".repeat(500)}\n${middleMarker}\n${"omega ".repeat(500)}`;

  const frame = await compileTurnSemantics({
    messages: [
      {
        role: "user",
        content,
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-long-write",
        sourceRef: "user:turn-long-write",
        observedAt,
      },
    ],
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileTurnSemantics: async () => ({}),
      compileLongTurnSemantics: async () => {
        throw new Error("long turn semantic scan must run in maintenance, not write hot path");
      },
    },
  });

  const hints = frameHintsForSourceRef(frame, "user:turn-long-write");

  assert.equal(hints, undefined);
  assert.equal(frame?.compilerProvenance.source, "llm");
});

test("maintenance long turn scan input uses persisted source segments", () => {
  const middleMarker = "MEMORY_MEMX_WRITE_MIDDLE_ENTITY_ANCHOR";
  const sourceRef = "user:turn-long-write";
  const base = {
    sourceGroupId: "source_group:1",
    parentSourceRef: sourceRef,
    chunkId: "chunk_1",
    agentId: "main",
    scope: "agent:main",
    sessionKey: "s1",
    turnId: "turn-long-write",
    seq: 0,
    role: "user",
    createdAt: observedAt,
    updatedAt: observedAt,
    metadataJson: {},
  };
  const input = buildLongTurnSemanticScanInputFromSegments([
    {
      ...base,
      segmentId: "segment_0",
      segmentIndex: 0,
      charStart: 0,
      charEnd: 1800,
      text: "alpha ".repeat(300),
      contentHash: "hash_0",
    },
    {
      ...base,
      segmentId: "segment_1",
      segmentIndex: 1,
      charStart: 1620,
      charEnd: 3420,
      text: `${"middle ".repeat(50)} ${middleMarker} ${"middle ".repeat(50)}`,
      contentHash: "hash_1",
    },
    {
      ...base,
      segmentId: "segment_2",
      segmentIndex: 2,
      charStart: 3240,
      charEnd: 5000,
      text: "omega ".repeat(300),
      contentHash: "hash_2",
    },
  ]);

  assert.equal(input.messages.length, 1);
  assert.equal(input.messages[0].sourceRef, sourceRef);
  assert.equal(input.messages[0].segmentCount, 3);
  assert.ok(input.messages[0].segments.some((segment) => segment.text.includes(middleMarker)));
});

test("query compiler protects task-bearing prompt from generic focused query", async () => {
  const query = [
    "You are solving an olympiad problem.",
    "",
    "Problem C8. Let n be a positive integer. Given an n x n board, the unit cell in the top left corner is initially coloured black, and the other cells are coloured white. In each operation, choose a 2 x 2 square with exactly one black cell and colour the remaining three cells black. Determine all values of n such that the whole board can become black.",
    "",
    "Give a rigorous solution.",
  ].join("\n");

  const compiled = await compileQuery({
    query,
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        focusedQuery: "Give a rigorous solution.",
        queryEntities: [],
        queryShape: {
          timeframe: "timeless",
          granularity: "summary",
          referentialMode: "anchored",
          evidenceNeed: "chunk",
        },
        primaryRoute: "factual",
      }),
    },
  });

  assert.match(compiled.focusedQuery, /Problem C8/);
  assert.match(compiled.focusedQuery, /n x n board/);
  assert.match(compiled.focusedQuery, /2 x 2 square/);
});

test("query compiler falls back to a neutral recall plan without deterministic semantics", async () => {
  const result = await compileQuery({
    query: "召回 e_p 和 sanity check 的相关记忆",
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => false,
    },
  });

  assert.equal(result.shouldRecall, true);
  assert.deepEqual(result.anchors, []);
  assert.ok(result.candidateSurfaces.includes("chunk"));
  assert.deepEqual(result.evidenceGoals, []);
  assert.equal(result.evidencePlan, undefined);
  assert.deepEqual(result.semanticBridges, undefined);
  assert.equal(result.supportNeed, 0);
  assert.ok((result.routeWeights.factual ?? 0) > 0);
  assert.equal(result.compilerProvenance.mode, "fallback");
  assert.ok(result.compilerProvenance.reasons?.includes("llm-only-query-compiler-unavailable"));
});

test("query compiler uses LLM semantics when available", async () => {
  const result = await compileQuery({
    query: "召回 e_p 和 sanity check 的相关记忆",
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        focusedQuery: "e_p sanity check",
        queryShape: {
          timeframe: "historical",
          granularity: "exact_detail",
          referentialMode: "anchored",
          evidenceNeed: "workflow_context",
        },
        answerGranularity: "detail",
        evidenceFidelity: "high",
        routeWeights: { workflow: 1 },
        anchors: ["e_p", "sanity check"],
        candidateSurfaces: ["task", "chunk"],
        evidenceGoals: [
          {
            goal: "Find prior correction about e_p sanity check",
            positiveQueries: ["e_p sanity check"],
            focusAnchors: ["e_p"],
            preferredSurfaces: ["task", "chunk"],
            fidelity: "high",
          },
        ],
        detailNeedScore: 0.9,
        supportNeed: 0.8,
        ambiguityLevel: 0.2,
        turnMode: "memory_qa",
      }),
    },
  });

  assert.equal(result.compilerProvenance.source, "llm");
  assert.deepEqual(result.anchors, ["e_p", "sanity check"]);
  assert.deepEqual(result.candidateSurfaces, ["task", "chunk"]);
  assert.equal(result.supportNeed, 0.8);
});

test("query compiler accepts lightweight query intent and derives entity recall surfaces", async () => {
  const result = await compileQuery({
    query: "之前 memx 的 node_modules 安装问题是什么",
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        shouldRecall: true,
        focusedQuery: "memx node_modules install blocker",
        queryEntities: [
          { name: "memx", type: "project", role: "subject" },
          { name: "n", type: "concept", role: "context" },
          { name: "Q", type: "concept", role: "context" },
        ],
        queryShape: {
          timeframe: "historical",
          granularity: "summary",
          referentialMode: "anchored",
          evidenceNeed: "factual_history",
        },
        primaryRoute: "factual",
      }),
    },
  });

  assert.equal(result.shouldRecall, true);
  assert.deepEqual(result.queryEntities, [
    { name: "memx", type: "project", role: "subject" },
  ]);
  assert.equal(result.primaryRoute, "factual");
  assert.ok((result.routeWeights.factual ?? 0) > 0.5);
  assert.ok(result.candidateSurfaces.includes("entity_alias"));
  assert.ok(result.candidateSurfaces.includes("fact"));
  assert.ok(result.evidencePlan);
  assert.ok(result.evidencePlan.slots.length > 0);
  assert.ok(result.semanticBridges?.length > 0);
  assert.ok(result.evidenceGoals.length > 0);
});

test("LLM query compiler output includes a downstream retrieval contract", async () => {
  const result = await compileQuery({
    query: "继续上次的 notecheck 工程任务，找回之前的约束和进度",
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        focusedQuery: "notecheck 工程任务 约束 进度",
        queryEntities: [{ name: "notecheck", type: "project", role: "subject" }],
        queryShape: {
          timeframe: "current",
          granularity: "detail",
          referentialMode: "anchored",
          evidenceNeed: "workflow_context",
        },
        primaryRoute: "workflow",
      }),
    },
  });

  assert.equal(result.compilerProvenance.source, "llm");
  assert.ok(result.evidenceGoals.length > 0);
  assert.ok(result.evidencePlan);
  assert.ok(result.evidencePlan.slots.some((slot) => slot.requiredFields.length > 0));
  assert.ok(result.semanticBridges?.some((bridge) => bridge.retrievalQueries.length > 0));
});

test("query compiler ignores no-recall output and only filters invalid entity hints", async () => {
  const result = await compileQuery({
    query:
      "Determine all integers n such that every polynomial with integer coefficients is n-good.",
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        shouldRecall: false,
        focusedQuery: "",
        queryEntities: [
          { name: "n", type: "concept", role: "subject" },
          { name: "P", type: "concept", role: "object" },
        ],
        queryShape: {
          timeframe: "timeless",
          granularity: "summary",
          referentialMode: "anchored",
          evidenceNeed: "chunk",
        },
        primaryRoute: "none",
      }),
    },
  });

  assert.equal(result.shouldRecall, true);
  assert.deepEqual(result.queryEntities, []);
  assert.ok(result.primaryRoute);
  assert.ok(Object.keys(result.routeWeights).length > 0);
  assert.ok(result.candidateSurfaces.includes("chunk"));
});

test("query compiler prompt input compacts long queries without scaffold raw-text leakage", () => {
  const middleMarker = "MIDDLE_ONLY_RECALL_MARKER_DO_NOT_LEAK";
  const query = `${"head context ".repeat(220)}\n${middleMarker}\n${"tail instruction ".repeat(220)}`;
  const fallback = compileQueryWithoutSemanticFallback(query);

  const promptInput = buildQueryCompilerPromptInput(query, fallback);
  const serialized = JSON.stringify(promptInput);

  assert.equal(promptInput.envelope.rawLength, query.length);
  assert.ok(promptInput.envelope.rawHash);
  assert.equal(promptInput.envelope.truncated, true);
  assert.ok(serialized.length < query.length);
  assert.equal(serialized.includes(middleMarker), false);
  assert.equal(serialized.includes(query), false);
  assert.ok(promptInput.scaffold.queryText.length < 400);
  assert.ok(promptInput.scaffold.focusedQuery.length < 260);
});

test("long query recall does not run a second LLM scan in the hook hot path", async () => {
  const query = `${"alpha ".repeat(500)}\nMEMORY_MEMX_DEEPSEEK_PROVIDER_MIDDLE_ANCHOR\n${"omega ".repeat(500)}`;
  let longScanCalled = false;

  const result = await compileQuery({
    query,
    ctx: minimalCtx(),
    reasoner: {
      isEnabled: () => true,
      compileQuerySemantics: async () => ({
        shouldRecall: false,
        focusedQuery: "",
        queryEntities: [],
        queryShape: {
          timeframe: "timeless",
          granularity: "summary",
          referentialMode: "anchored",
          evidenceNeed: "chunk",
        },
        primaryRoute: "none",
      }),
      compileLongQuerySemantics: async () => {
        longScanCalled = true;
        throw new Error("long query scan must not run in before_prompt_build");
      },
    },
  });

  assert.equal(longScanCalled, false);
  assert.equal(result.shouldRecall, true);
  assert.ok(result.primaryRoute);
});

test("normalization does not synthesize reported_detail facts without LLM assertions", () => {
  const outputs = normalizeCandidate(
    {
      candidateId: "candidate_no_shadow_fact",
      source: {
        kind: "user",
        sessionKey: "s1",
      },
      observedAt,
      rawText: "OpenClaw budget is 123 and DeepSeek provider changed today.",
      normalizedText: "openclaw budget is 123 and deepseek provider changed today.",
      eventType: "conversation_turn",
      structuredHints: {
        entities: [],
        timeHints: [],
        semanticDraft: {
          sourceRef: "user:turn-no-shadow",
          assertionDrafts: [],
          correctionDrafts: [],
          supportSpans: [],
          compilerProvenance: {
            source: "llm",
            mode: "llm",
          },
        },
      },
      metadata: {
        sourceRef: "user:turn-no-shadow",
      },
      classification: "episodic-event",
      policy: {
        salienceScore: 0.9,
        expectedFutureUtility: 0.9,
        sensitivityScore: 0,
        stabilityScore: 0.9,
        action: "durable",
        reasons: ["test"],
        explicitIntent: true,
        captureAuthorized: true,
      },
      confidence: 0.9,
      scope: "agent:main",
    },
    minimalCtx(),
  );

  assert.equal(outputs.facts.some((fact) => fact.predicate === "reported_detail"), false);
});

test("reasoner summaries and topic judgments do not rebuild semantics without LLM", async () => {
  const reasoner = new MemxReasoner(minimalConfig(), {
    debug() {},
    info() {},
    warn() {},
  });

  const chunkSummary = await reasoner.summarizeChunk(
    "记住：DeepSeek 是当前 provider，OpenClaw 是项目。",
    "user",
  );
  const taskSummary = await reasoner.summarizeTask([
    {
      chunkId: "chunk_1",
      agentId: "main",
      scope: "agent:main",
      sessionKey: "s1",
      turnId: "turn3",
      seq: 0,
      role: "user",
      chunkKind: "message",
      content: "继续 OpenClaw 的 DeepSeek provider 配置。",
      summary: "",
      contentHash: "hash_1",
      taskId: "task_1",
      dedupStatus: "active",
      mergeCount: 0,
      sourceRef: "user:turn3",
      createdAt: observedAt,
      updatedAt: observedAt,
    },
  ]);
  const topicDecision = await reasoner.judgeNewTopic(
    "OpenClaw memory plugin setup",
    "DeepSeek provider config",
  );

  assert.equal(chunkSummary, "");
  assert.equal(taskSummary.title, "Conversation task");
  assert.equal(taskSummary.summary, "");
  assert.equal(taskSummary.metadataJson.summarySource, "llm_unavailable");
  assert.equal(topicDecision, null);
});
