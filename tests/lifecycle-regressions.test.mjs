import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { DEFAULT_MEMORY_CONFIG } from "../dist/.runtime/src/config.mjs";
import { buildOperationContext, MemxRuntimeManager } from "../dist/.runtime/src/runtime.mjs";
import { runAutomaticMaintenanceBatch } from "../dist/.runtime/src/pipeline/maintenanceBatch.mjs";
import {
  MEMX_NATIVE_HOOK_TIMEOUT_MS,
  deriveNativeHookHttpTimeoutMs,
  deriveNativeHookQueryCompilerTimeoutMs,
} from "../dist/.runtime/src/timeouts.mjs";

const observedAt = "2026-05-21T00:00:00.000Z";

function logger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function configFor(dbPath) {
  return {
    ...DEFAULT_MEMORY_CONFIG,
    dbPath,
    embedding: {
      ...DEFAULT_MEMORY_CONFIG.embedding,
      provider: "off",
    },
    advanced: {
      ...DEFAULT_MEMORY_CONFIG.advanced,
      enableTurnSemanticCompiler: true,
      enableTelemetryAudit: true,
      enableMaintenanceJobs: true,
      enableEmbeddingCandidates: false,
      maintenanceTriggerMode: "batched",
      maintenanceBatchTurns: 3,
    },
  };
}

function ctxFor(dbPath) {
  const config = configFor(dbPath);
  return {
    agentId: "main",
    sessionKey: "s1",
    workspaceDir: "/tmp/memx-lifecycle-test",
    project: "memx-lifecycle",
    runId: "test-run",
    channelId: "test-channel",
    config,
    dbPath,
    scopes: ["agent:main"],
    now: observedAt,
    llmBudgetAudit: {
      calls: [],
      hotPathLlmCallCount: 0,
      writeHotPathLlmCallCount: 0,
      queryHotPathLlmCallCount: 0,
      postAnswerWritebackLlmCallCount: 0,
      maintenanceLlmCallCount: 0,
    },
  };
}

function relationPatch(sourceRef) {
  return {
    sourceRefs: [sourceRef],
    assertionDrafts: [
      {
        draftId: "draft-relation",
        sourceRef,
        familyHint: "relation_like",
        timeframeHint: "current",
        entityHints: [
          { name: "InvoicePilot", type: "project" },
          { name: "PostgreSQL", type: "service" },
        ],
        confidence: 0.92,
        lineage: { sourceKind: "chunk", sourceId: "chunk-test", sourceRef },
      },
    ],
    relationDrafts: [
      {
        sourceRef,
        relation: {
          subject: "InvoicePilot",
          predicate: "uses",
          relationSlot: "database",
          object: "PostgreSQL",
          sourceRef,
          confidence: 0.92,
        },
        confidence: 0.92,
        lineage: { sourceKind: "chunk", sourceId: "chunk-test", sourceRef },
      },
    ],
    supportSpans: [{ sourceRef, text: "InvoicePilot 默认数据库是 PostgreSQL" }],
    compilerProvenance: {
      source: "llm",
      mode: "semantic-compiler-authoritative",
      reasons: ["test-semantic-frame"],
    },
  };
}

test("native hook timeout budget keeps query compiler inside the unified 8 second hook limit", () => {
  const httpTimeoutMs = deriveNativeHookHttpTimeoutMs(MEMX_NATIVE_HOOK_TIMEOUT_MS);
  const queryTimeoutMs = deriveNativeHookQueryCompilerTimeoutMs(httpTimeoutMs);

  assert.equal(MEMX_NATIVE_HOOK_TIMEOUT_MS, 8000);
  assert.equal(httpTimeoutMs, 7500);
  assert.equal(queryTimeoutMs, 7250);
  assert.ok(queryTimeoutMs < httpTimeoutMs);
});

test("SessionEnd without a pending turn does not replay the latest transcript assistant", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-hook-sessionend-"));
  const transcriptPath = join(tempDir, "claude-session.jsonl");
  const pendingDir = join(tempDir, "pending");
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        url: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "assistant output that was already captured" }] },
      })}\n`,
      "utf8",
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const child = spawn(process.execPath, ["dist/.runtime/src/bin/memx-hook.mjs", "claude-code", "SessionEnd"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMX_URL: `http://127.0.0.1:${port}`,
        MEMX_PENDING_DIR: pendingDir,
        MEMX_TRANSCRIPT_CAPTURE_TIMEOUT_MS: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(
      JSON.stringify({
        session_id: "session-no-pending",
        cwd: "/tmp/memx-lifecycle-test",
        transcript_path: transcriptPath,
      }),
    );
    const code = await new Promise((resolve) => child.on("close", resolve));

    assert.equal(code, 0);
    assert.deepEqual(requests, []);
  } finally {
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("turn scheduler sends the complete user plus assistant turn to the LLM semantic compiler", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-turn-semantic-"));
  const dbPath = join(tempDir, "memx.sqlite");

  try {
    const manager = new MemxRuntimeManager(logger());
    const ctx = ctxFor(dbPath);
    const store = await manager.getStore(ctx);
    let capturedMessages = [];
    const chunkSummaryOptions = [];
    store.reasoner.isEnabled = () => true;
    store.reasoner.summarizeChunk = async (text, _role, options = {}) => {
      chunkSummaryOptions.push(options);
      return text.slice(0, 120);
    };
    store.reasoner.compileTurnSemantics = async (messages) => {
      capturedMessages = messages;
      return relationPatch("user:turn-semantic:0");
    };

    await store.turnScheduler.enqueue(ctx, [
      {
        role: "user",
        content: "记住：InvoicePilot 默认数据库是 PostgreSQL。",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-semantic",
        sourceRef: "user:turn-semantic:0",
        observedAt,
      },
      {
        role: "assistant",
        content: "好的，后续我会按 PostgreSQL 处理 InvoicePilot 的默认数据库。",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-semantic",
        sourceRef: "assistant:turn-semantic:1",
        observedAt,
      },
    ]);
    await store.turnScheduler.flush();

    assert.deepEqual(
      capturedMessages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.deepEqual(
      chunkSummaryOptions.map((options) => options.allowLlm),
      [false, false],
      "chunk summaries should be local previews; semantic extraction belongs to the turn compiler",
    );
    assert.equal(
      store.client.prepare("SELECT COUNT(*) AS count FROM conversation_chunks WHERE role = 'assistant'").get()
        .count,
      1,
    );
    assert.ok(
      Number(store.client.prepare("SELECT COUNT(*) AS count FROM graph_edges").get().count) > 0,
      "LLM relation drafts should be materialized into graph edges",
    );
    const ignored = store.client
      .prepare("SELECT reasons_json FROM policy_decisions WHERE reasons_json LIKE ?")
      .all("%no-compiler-family%");
    assert.deepEqual(ignored, []);
    await manager.closeAll();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("host observe stages recallable chunks before the background semantic queue", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-host-stage-"));
  const dbPath = join(tempDir, "{agentId}", "memx.sqlite");

  try {
    const { MemxHostService } = await import("../dist/.runtime/src/host/service.mjs");
    const config = configFor(dbPath);
    config.advanced.enableMaintenanceJobs = false;
    const service = new MemxHostService({ config, logger: logger() });
    const ctx = buildOperationContext(config, {
      agentId: "stage-agent",
      sessionKey: "generic:s1",
      workspaceDir: "/tmp/memx-lifecycle-test",
      project: "stage-test",
    });
    const store = await service.manager.getStore(ctx);
    store.turnScheduler.enqueue = async () => {
      // Simulate the heavy semantic queue being unavailable. Raw turn evidence
      // should still be visible after observe returns.
    };

    await service.observe({
      hostId: "generic",
      actorId: "stage-agent",
      sessionId: "s1",
      workspaceDir: "/tmp/memx-lifecycle-test",
      eventName: "turn",
      observedAt,
      messages: [
        {
          role: "user",
          content: "AuroraAccept 的导出格式改成 Arrow IPC。",
        },
        {
          role: "assistant",
          content: "好的，AuroraAccept 的导出格式按 Arrow IPC 处理。",
        },
      ],
    });

    assert.equal(
      store.client.prepare("SELECT COUNT(*) AS count FROM conversation_chunks").get().count,
      2,
    );
    assert.ok(
      Number(store.client.prepare("SELECT COUNT(*) AS count FROM source_segments").get().count) >= 2,
    );
    assert.ok(
      Number(store.client.prepare("SELECT COUNT(*) AS count FROM vector_docs").get().count) >= 2,
    );
    await service.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("native context includes staged turn evidence while semantic write is still pending", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-host-pending-context-"));
  const dbPath = join(tempDir, "{agentId}", "memx.sqlite");

  try {
    const { MemxHostService } = await import("../dist/.runtime/src/host/service.mjs");
    const config = configFor(dbPath);
    config.advanced.enableMaintenanceJobs = false;
    config.advanced.enableQueryCompiler = false;
    const service = new MemxHostService({ config, logger: logger() });
    const ctx = buildOperationContext(config, {
      agentId: "stage-agent",
      sessionKey: "generic:s1",
      workspaceDir: "/tmp/memx-lifecycle-test",
      project: "stage-test",
    });
    await service.manager.getStore(ctx);
    service.manager.rememberStagedRecallableTurn(ctx, [
      {
        role: "user",
        content: "刚才那个导出格式不要再用 Parquet 了，这个改成 Arrow IPC。",
        scope: "agent:stage-agent",
        sessionKey: "generic:s1",
        turnId: "turn-pending-update",
        sourceRef: "user:turn-pending-update",
        observedAt,
      },
      {
        role: "assistant",
        content: "好的，AuroraAccept 的导出格式从 Parquet 改为 Arrow IPC。",
        scope: "agent:stage-agent",
        sessionKey: "generic:s1",
        turnId: "turn-pending-update",
        sourceRef: "assistant:turn-pending-update",
        observedAt,
      },
    ]);
    service.pendingWrites.set("stage-agent\u0000generic:s1", new Promise(() => {}));

    const result = await service.context({
      hostId: "generic",
      actorId: "stage-agent",
      sessionId: "s1",
      workspaceDir: "/tmp/memx-lifecycle-test",
      query: "AuroraAccept 的导出格式现在是什么？",
      hotPathTimeoutMs: 1600,
    });

    assert.match(result.prependContext, /Arrow IPC/);
    assert.equal(result.recall.diagnostics.includes("pending-staged-turn-evidence"), true);
    service.pendingWrites.clear();
    await service.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("maintenance source segment semantic extraction records auditable run stats", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-maintenance-source-"));
  const dbPath = join(tempDir, "memx.sqlite");

  try {
    const manager = new MemxRuntimeManager(logger());
    const ctx = ctxFor(dbPath);
    const store = await manager.getStore(ctx);
    const sourceRef = "user:turn-maintenance:0";
    store.reasoner.isEnabled = () => true;
    store.reasoner.compileLongTurnSemantics = async () => relationPatch(sourceRef);
    store.chunkRepo.insert({
      chunkId: "chunk-maintenance",
      agentId: "main",
      scope: "agent:main",
      sessionKey: "s1",
      turnId: "turn-maintenance",
      seq: 0,
      role: "user",
      chunkKind: "message",
      content: "InvoicePilot 默认数据库是 PostgreSQL。",
      summary: "",
      contentHash: "hash-maintenance-0",
      dedupStatus: "active",
      mergeCount: 0,
      sourceRef,
      createdAt: observedAt,
      updatedAt: observedAt,
    });
    store.sourceSegmentRepo.insertMany([
      {
        segmentId: "segment-maintenance-0",
        sourceGroupId: "group-maintenance",
        parentSourceRef: sourceRef,
        chunkId: "chunk-maintenance",
        agentId: "main",
        scope: "agent:main",
        sessionKey: "s1",
        turnId: "turn-maintenance",
        seq: 0,
        role: "user",
        segmentIndex: 0,
        charStart: 0,
        charEnd: 42,
        text: "InvoicePilot 默认数据库是 PostgreSQL。",
        contentHash: "hash-maintenance-0",
        createdAt: observedAt,
        updatedAt: observedAt,
        metadataJson: {},
      },
    ]);

    await runAutomaticMaintenanceBatch(store, ctx, {
      sessionKey: "s1",
      turnIds: ["turn-maintenance"],
      turnCount: 1,
      reason: "threshold",
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      lowerWatermarks: {},
      upperWatermarks: {},
    });

    const rows = store.client
      .prepare("SELECT job_type, status, stats_json FROM maintenance_runs WHERE job_type = ?")
      .all("source-segment-semantic-extraction");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "completed");
    const stats = JSON.parse(rows[0].stats_json);
    assert.equal(stats.sourceGroupsScanned, 1);
    assert.ok(stats.candidatesWritten > 0);
    await manager.closeAll();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
