import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MEMORY_CONFIG } from "../dist/src/config.mjs";
import { MemxDbClient } from "../dist/src/db/client.mjs";
import { MaintenanceRepo } from "../dist/src/db/repositories/maintenanceRepo.mjs";
import { MemxRuntimeManager } from "../dist/src/runtime.mjs";

const observedAt = "2026-05-13T00:00:00.000Z";

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
      enableMaintenanceJobs: true,
      maintenanceTriggerMode: "batched",
      maintenanceBatchTurns: 3,
      maintenanceIdleFlushMinutes: 10,
      enableEmbeddingCandidates: false,
    },
  };
}

function ctxFor(dbPath) {
  const config = configFor(dbPath);
  return {
    agentId: "main",
    sessionKey: "active-session",
    workspaceDir: "/tmp/memx-test-workspace",
    project: "memx-test",
    runId: "test-run",
    channelId: "test-channel",
    config,
    dbPath,
    scopes: ["agent:main"],
    now: observedAt,
  };
}

test("runtime shutdown flushes persisted maintenance rows without an in-memory session context", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "memx-maintenance-resume-"));
  const dbPath = join(tempDir, "memx.sqlite");

  try {
    const manager = new MemxRuntimeManager(logger());
    const store = await manager.getStore(ctxFor(dbPath));

    store.maintenanceRepo.recordPendingTurn({
      agentId: "main",
      sessionKey: "orphan-session",
      turnId: "turn-orphan",
      observedAt,
      updatedAt: observedAt,
    });

    await manager.closeAll();

    const client = await MemxDbClient.open(dbPath);
    try {
      const repo = new MaintenanceRepo(client);
      const state = repo.getState("main", "orphan-session");
      assert.ok(state);
      assert.equal(state.pendingTurnCount, 0);
      assert.equal(state.inflightTurnCount, 0);
      assert.equal(state.status, "idle");
      const runCount = client
        .prepare("SELECT COUNT(*) AS count FROM maintenance_runs")
        .get().count;
      assert.ok(Number(runCount) > 0);
    } finally {
      client.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
