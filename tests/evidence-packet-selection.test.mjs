import assert from "node:assert/strict";
import test from "node:test";
import { assembleEvidencePackets } from "../dist/.runtime/src/pipeline/evidenceAssembler.mjs";
import { collectBehavioralGuidance } from "../dist/.runtime/src/pipeline/memoryObjects.mjs";
import { compileQueryWithoutSemanticFallback } from "../dist/.runtime/src/pipeline/queryCompiler.mjs";

function queryAnalysis(query) {
  return {
    ...compileQueryWithoutSemanticFallback(query),
    answerMode: "single_fact",
    evidenceFidelity: "medium",
    evidenceCoverage: "minimal",
    supportNeed: 0.4,
    ambiguityLevel: 0.1,
    evidencePlan: {
      operation: {
        type: "return_value",
        description: "Return the value directly supported by filled evidence slots.",
      },
      slots: [
        {
          id: "query_context",
          role: "query_context",
          requiredRole: "query_context",
          description: "Subject or situation the answer must be bound to.",
          subjectHints: [query],
          relationHints: ["query context"],
          capabilityQueries: [],
          negativeHints: [],
          requiredFields: ["query_context"],
          preferredLayers: ["chunk"],
          fallbackLayers: ["chunk"],
          minEvidence: 1,
        },
        {
          id: "answer_value",
          role: "answer_value",
          requiredRole: "answer_value",
          description: "Evidence that can directly answer the query.",
          subjectHints: [query],
          relationHints: [],
          capabilityQueries: [],
          negativeHints: [],
          requiredFields: ["answer_value"],
          preferredLayers: ["chunk"],
          fallbackLayers: ["chunk"],
          minEvidence: 1,
        },
      ],
    },
    semanticBridges: [],
  };
}

function chunkCandidate(query, overrides = {}) {
  return {
    id: "event:chunk:test",
    surface: "chunk",
    text: "[answer] 旧任务：Work only inside /Users/dali/.openclaw/workspace/notecheck-lab.",
    rawText: "user: Work only inside /Users/dali/.openclaw/workspace/notecheck-lab.",
    metadata: { role: "user" },
    sourceRef: "user:test",
    mergedSourceRefs: ["user:test"],
    observedAt: "2026-05-12T00:00:00.000Z",
    excerptAnchors: [query],
    priority: 0.35,
    goalScore: 0.3,
    semanticScore: 0.3,
    coverage: {
      requiredHits: [],
      missingRequired: [],
      coverageScore: 1,
      answerMode: "single_fact",
    },
    slotCoverage: [
      {
        slotId: "query_context",
        requiredHits: [],
        missingRequired: [query],
        coverageScore: 0.19,
        filled: false,
      },
      {
        slotId: "answer_value",
        requiredHits: [],
        missingRequired: [query],
        coverageScore: 0.23,
        filled: false,
      },
    ],
    filledSlotIds: [],
    injectionScore: 0.36,
    source: "candidate",
    role: "protected",
    ...overrides,
  };
}

test("unfilled stale task instructions are not injected as priority evidence", () => {
  const query = "请在当前工作区的 notecheck-lab 工程里检查中文标题/锚点修复是否完整";

  const result = assembleEvidencePackets({
    queryAnalysis: queryAnalysis(query),
    promptEvidence: [chunkCandidate(query)],
    now: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].injected, false);
  assert.equal(result.packets[0].coverage.filled, false);
  assert.equal(result.promptEvidence[0].injected, false);
  assert.equal(result.promptEvidence[0].role, "support");
});

test("filled evidence packets are still injected", () => {
  const query = "请检查 notecheck-lab 中文锚点修复是否通过测试";
  const result = assembleEvidencePackets({
    queryAnalysis: queryAnalysis(query),
    promptEvidence: [
      chunkCandidate(query, {
        text: "[answer] notecheck 中文锚点修复已通过 62 项测试。",
        rawText: "assistant: notecheck 中文锚点修复已通过 62 项测试。",
        slotCoverage: [
          {
            slotId: "query_context",
            requiredHits: [query],
            missingRequired: [],
            coverageScore: 0.9,
            filled: true,
          },
          {
            slotId: "answer_value",
            requiredHits: ["通过 62 项测试"],
            missingRequired: [],
            coverageScore: 0.9,
            filled: true,
          },
        ],
        filledSlotIds: ["query_context", "answer_value"],
      }),
    ],
    now: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].injected, true);
  assert.equal(result.packets[0].coverage.filled, true);
  assert.equal(result.promptEvidence[0].injected, true);
  assert.equal(result.promptEvidence[0].role, "protected");
});

test("task-scoped workflow guidance is excluded from ambient reply guidance", () => {
  const workflowFact = {
    factId: "workflow_fact",
    canonicalSubject: "user",
    predicate: "has_workflow_guidance",
    objectValueJson: {
      guidance: {
        guidanceType: "generic_preference",
        guidanceText: "When this workflow pattern applies, solve the old math problem this way.",
      },
    },
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
  const languageFact = {
    factId: "language_fact",
    canonicalSubject: "user",
    predicate: "prefers_language",
    objectValueJson: {
      guidance: {
        guidanceType: "language",
        guidanceText: "Default to Chinese responses unless the current turn asks otherwise.",
      },
    },
    updatedAt: "2026-05-13T00:00:00.000Z",
  };
  const store = {
    beliefRepo: {
      listByAgent() {
        return [];
      },
    },
    factRepo: {
      query() {
        return [workflowFact, languageFact];
      },
    },
  };

  assert.deepEqual(
    collectBehavioralGuidance(store, {
      agentId: "main",
      scopes: ["agent:main"],
    }),
    ["Default to Chinese responses unless the current turn asks otherwise."],
  );
});
