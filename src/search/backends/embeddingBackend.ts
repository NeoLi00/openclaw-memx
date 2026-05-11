import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { VectorRepo } from "../../db/repositories/vectorRepo.js";
import { cosineSimilarity, orderByScore } from "../../support.js";
import type {
  EmbeddingConfig,
  RetrievalBackend,
  RetrievalSearchParams,
  SearchHit,
  VectorDocRecord,
} from "../../types.js";
import type { MemxLogger } from "../../types.js";
import { SqliteFtsBackend } from "./ftsBackend.js";
import { mergeHybridHits } from "./hybrid.js";

type EmbedMode = "query" | "passage";
type LocalWorkerResponse = {
  id: number;
  embeddings?: number[][];
  error?: string;
};
type PendingLocalEmbeddingRequest = {
  resolve: (embeddings: number[][]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class LocalEmbeddingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalEmbeddingTimeoutError";
  }
}

class LocalEmbeddingHardFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalEmbeddingHardFailureError";
  }
}

const DEFAULT_LOCAL_MODEL = "intfloat/multilingual-e5-small";
const DEFAULT_LOCAL_PYTHON_BIN = "python3";
const DEFAULT_LOCAL_DEVICE = "auto";
const LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS = 120_000;
const LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS = 300_000;
const LOCAL_WORKER_PATH = fileURLToPath(
  new URL("../../../sentence_transformers_embedder.py", import.meta.url),
);

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function resolveLocalModel(config: EmbeddingConfig): string {
  return config.model?.trim() || DEFAULT_LOCAL_MODEL;
}

function resolveLocalPythonBin(config: EmbeddingConfig): string {
  return config.localPythonBin?.trim() || DEFAULT_LOCAL_PYTHON_BIN;
}

function resolveLocalDevice(config: EmbeddingConfig): string {
  return config.localDevice?.trim() || DEFAULT_LOCAL_DEVICE;
}

class LocalSentenceTransformerWorker {
  private nextId = 1;
  private hasCompletedRequest = false;
  private closed = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutLines: Interface | null = null;
  private stderrBuffer = "";
  private readonly pending = new Map<number, PendingLocalEmbeddingRequest>();

  constructor(
    private readonly config: EmbeddingConfig,
    private readonly logger: MemxLogger,
  ) {}

  async embed(texts: string[], mode: EmbedMode): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (this.closed) {
      throw new Error("local sentence-transformers worker is closed");
    }
    const id = this.nextId++;
    const payload = JSON.stringify({
      id,
      mode,
      texts,
    });
    const timeoutMs = this.hasCompletedRequest
      ? LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS
      : LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS;
    const child = this.ensureWorker();

    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new LocalEmbeddingTimeoutError(
          `local sentence-transformers request timed out (${mode}, ${timeoutMs}ms)`,
        );
        void this.stopWorker();
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      child.stdin.write(`${payload}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(new LocalEmbeddingHardFailureError(String(error)));
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPending(new LocalEmbeddingHardFailureError("local sentence-transformers worker closed"));
    await this.stopWorker();
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.closed) {
      throw new Error("local sentence-transformers worker is closed");
    }
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const args = [
      LOCAL_WORKER_PATH,
      "--model",
      resolveLocalModel(this.config),
      "--device",
      resolveLocalDevice(this.config),
    ];
    if (this.config.localCacheDir?.trim()) {
      args.push("--cache-dir", this.config.localCacheDir.trim());
    }

    const child = spawn(resolveLocalPythonBin(this.config), args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stderrBuffer = "";
    const stdoutLines = createInterface({ input: child.stdout });
    this.stdoutLines = stdoutLines;
    stdoutLines.on("line", (line) => this.handleWorkerLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => {
      this.failPending(new LocalEmbeddingHardFailureError(String(error)));
      this.child = null;
    });
    child.on("exit", (code, signal) => {
      const isActiveChild = this.child === child;
      if (isActiveChild) {
        this.child = null;
        this.stdoutLines?.close();
        this.stdoutLines = null;
      } else {
        stdoutLines.close();
      }
      if (this.closed || this.pending.size === 0) {
        return;
      }
      const suffix = this.stderrBuffer.trim() ? `; stderr: ${this.stderrBuffer.trim()}` : "";
      this.failPending(
        new LocalEmbeddingHardFailureError(
          `local sentence-transformers worker exited with code ${code ?? -1}${
            signal ? ` signal ${signal}` : ""
          }${suffix}`,
        ),
      );
    });

    return child;
  }

  private handleWorkerLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    let response: LocalWorkerResponse;
    try {
      response = JSON.parse(line) as LocalWorkerResponse;
    } catch (error) {
      this.logger.warn(
        `memory-memx: failed to parse local embedding worker output (${String(error)})`,
      );
      this.failPending(new LocalEmbeddingHardFailureError(String(error)));
      void this.stopWorker();
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(new LocalEmbeddingHardFailureError(response.error));
      return;
    }
    this.hasCompletedRequest = true;
    pending.resolve(response.embeddings ?? []);
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private async stopWorker(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.stdoutLines?.close();
    this.stdoutLines = null;
    if (!child || child.killed) {
      return;
    }
    child.stdin.destroy();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

async function embedTextsRemote(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  if (config.provider === "openai-compatible") {
    const url = `${config.baseURL?.replace(/\/$/, "") ?? ""}/embeddings`;
    const body = {
      model: config.model,
      input: texts,
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    };
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(config.headers ?? {}),
    };
    if (config.apiKey) {
      headers.authorization = `Bearer ${config.apiKey}`;
    }
    const json = (await fetchJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })) as { data?: Array<{ embedding?: number[] }> };
    return (json.data ?? []).map((entry) => entry.embedding ?? []);
  }

  const vectors = await Promise.all(
    texts.map(async (text) => {
      const url = `${config.ollamaBaseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434"}/api/embeddings`;
      const json = (await fetchJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.ollamaModel ?? config.model,
          prompt: text,
        }),
      })) as { embedding?: number[] };
      return json.embedding ?? [];
    }),
  );
  return vectors;
}

export class OptionalEmbeddingBackend implements RetrievalBackend {
  private readonly lexical: SqliteFtsBackend;
  private readonly localWorker: LocalSentenceTransformerWorker | null;
  private warnedUnavailable = false;
  private acceptingUpserts = true;
  private localUnavailableForProcess = false;
  private closed = false;
  private upsertQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: VectorRepo,
    private readonly embedding: EmbeddingConfig,
    private readonly logger: MemxLogger,
  ) {
    this.lexical = new SqliteFtsBackend(repo);
    this.localWorker =
      embedding.provider === "sentence-transformers-local"
        ? new LocalSentenceTransformerWorker(embedding, logger)
        : null;
  }

  upsertDocs(docs: VectorDocRecord[]): void {
    this.repo.upsertDocs(docs);
    if (
      this.embedding.provider === "off" ||
      !this.acceptingUpserts ||
      this.closed ||
      this.isEmbeddingDisabledForProcess()
    ) {
      return;
    }
    const eligibleDocs = docs.filter((doc) => doc.text.trim().length > 0);
    if (eligibleDocs.length === 0) {
      return;
    }
    this.upsertQueue = this.upsertQueue
      .then(async () => {
        const vectors = await this.embedTexts(
          eligibleDocs.map((doc) => doc.text),
          "passage",
          "vector-upsert",
        );
        if (this.closed) {
          return;
        }
        for (const [index, doc] of eligibleDocs.entries()) {
          const vector = vectors[index] ?? [];
          if (vector.length === 0) {
            continue;
          }
          this.repo.upsertEmbedding({
            docId: doc.docId,
            agentId: doc.agentId,
            scope: doc.scope,
            embedding: vector,
            updatedAt: doc.updatedAt,
          });
        }
      })
      .catch((error) => {
        this.handleEmbeddingFailure(
          error,
          `memory-memx: embeddings unavailable, using lexical retrieval only (${String(error)})`,
        );
      });
  }

  async flushPendingUpserts(): Promise<void> {
    let pending = this.upsertQueue;
    while (true) {
      await pending;
      if (pending === this.upsertQueue) {
        return;
      }
      pending = this.upsertQueue;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.acceptingUpserts = false;
    await this.flushPendingUpserts();
    this.closed = true;
    await this.localWorker?.close();
  }

  deleteDocs(docIds: string[]): void {
    this.repo.deleteDocs(docIds);
  }

  keywordSearch(params: RetrievalSearchParams): SearchHit[] {
    return this.lexical.keywordSearch(params);
  }

  async similaritySearch(params: RetrievalSearchParams): Promise<SearchHit[]> {
    if (this.embedding.provider === "off" || this.isEmbeddingDisabledForProcess()) {
      return [];
    }
    try {
      const [queryEmbedding] = await this.embedTexts([params.query], "query", "similarity-search");
      if (!queryEmbedding || queryEmbedding.length === 0) {
        return [];
      }
      const rows = this.repo.listEmbeddings({
        agentId: params.agentId,
        scopes: params.scopes,
        limit: Math.max(params.limit * 16, 128),
        readEpoch: params.readEpoch,
        docKinds: params.docKinds,
        docTypes: params.docTypes,
      });
      const hits: SearchHit[] = [];
      for (const row of rows) {
        const score = cosineSimilarity(queryEmbedding, row.embedding);
        if (score <= 0) {
          continue;
        }
        const doc = this.repo.getDoc(row.docId, params.readEpoch);
        if (!doc) {
          continue;
        }
        hits.push({
          docId: doc.docId,
          text: doc.text,
          metadata: doc.metadataJson,
          score,
          backend: "embedding",
        });
      }
      return orderByScore(hits).slice(0, params.limit);
    } catch (error) {
      this.handleEmbeddingFailure(
        error,
        `memory-memx: similarity search failed, falling back to FTS (${String(error)})`,
      );
      return [];
    }
  }

  async hybridSearch(params: RetrievalSearchParams): Promise<SearchHit[]> {
    const keywordHits = this.keywordSearch(params);
    const similarityHits = await this.similaritySearch(params);
    return mergeHybridHits(params.query, keywordHits, similarityHits, params.limit);
  }

  async embedTextsBatch(texts: string[], mode: EmbedMode = "passage"): Promise<number[][]> {
    if (this.isEmbeddingDisabledForProcess()) {
      return [];
    }
    try {
      return await this.embedTexts(texts, mode, "batch");
    } catch (error) {
      this.handleEmbeddingFailure(
        error,
        `memory-memx: embedding batch unavailable, using lexical fallback (${String(error)})`,
      );
      return [];
    }
  }

  private isEmbeddingDisabledForProcess(): boolean {
    return this.embedding.provider === "sentence-transformers-local" && this.localUnavailableForProcess;
  }

  private handleEmbeddingFailure(error: unknown, message: string): void {
    this.warnOnce(message);
    if (
      this.embedding.provider !== "sentence-transformers-local" ||
      error instanceof LocalEmbeddingTimeoutError
    ) {
      return;
    }
    this.localUnavailableForProcess = true;
    this.acceptingUpserts = false;
    void this.localWorker?.close().catch((error) => {
      this.logger.debug?.(
        `memory-memx: failed to close unavailable local embedding worker (${String(error)})`,
      );
    });
  }

  private warnOnce(message: string): void {
    if (this.warnedUnavailable) {
      return;
    }
    this.warnedUnavailable = true;
    this.logger.warn(message);
  }

  private async embedTexts(
    texts: string[],
    mode: EmbedMode,
    label: "vector-upsert" | "similarity-search" | "batch",
  ): Promise<number[][]> {
    if (this.embedding.provider === "off") {
      throw new Error("embeddings disabled");
    }
    if (this.isEmbeddingDisabledForProcess()) {
      throw new Error("local embeddings unavailable for this process");
    }
    const started = Date.now();
    try {
      if (this.embedding.provider === "sentence-transformers-local") {
        if (!this.localWorker) {
          throw new Error("local sentence-transformers worker unavailable");
        }
        return await this.localWorker.embed(texts, mode);
      }
      return await embedTextsRemote(this.embedding, texts);
    } finally {
      const elapsedMs = Math.max(0, Date.now() - started);
      this.logger.info?.(
        `memory-memx: TIMING embedding label=${label} mode=${mode} batch=${texts.length} provider=${this.embedding.provider} elapsed=${elapsedMs}ms`,
      );
    }
  }
}
