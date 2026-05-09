import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cosineSimilarity, orderByScore } from "../../support.js";
import { SqliteFtsBackend } from "./ftsBackend.js";
import { mergeHybridHits } from "./hybrid.js";
class LocalEmbeddingTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "LocalEmbeddingTimeoutError";
    }
}
class LocalEmbeddingHardFailureError extends Error {
    constructor(message) {
        super(message);
        this.name = "LocalEmbeddingHardFailureError";
    }
}
const DEFAULT_LOCAL_MODEL = "intfloat/multilingual-e5-small";
const DEFAULT_LOCAL_PYTHON_BIN = "python3";
const DEFAULT_LOCAL_DEVICE = "auto";
const LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS = 120_000;
const LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS = 300_000;
const LOCAL_WORKER_PATH = fileURLToPath(new URL("./sentence_transformers_embedder.py", import.meta.url));
async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.json();
}
function resolveLocalWorkerPath() {
    return process.env.MEMX_SENTENCE_TRANSFORMERS_HELPER?.trim() || LOCAL_WORKER_PATH;
}
function resolveLocalModel(config) {
    return config.model?.trim() || DEFAULT_LOCAL_MODEL;
}
function resolveLocalPythonBin(config) {
    return config.localPythonBin?.trim() || DEFAULT_LOCAL_PYTHON_BIN;
}
function resolveLocalDevice(config) {
    return config.localDevice?.trim() || DEFAULT_LOCAL_DEVICE;
}
function resolveTimeoutOverride(envName, fallback) {
    const raw = process.env[envName]?.trim();
    if (!raw) {
        return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
class LocalSentenceTransformerWorker {
    config;
    logger;
    proc = null;
    buffer = "";
    nextId = 1;
    lastError = "";
    hasCompletedRequest = false;
    hasColdStartTimedOut = false;
    closed = false;
    pending = new Map();
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }
    async embed(texts, mode) {
        if (texts.length === 0) {
            return [];
        }
        if (this.closed) {
            throw new Error("local sentence-transformers worker is closed");
        }
        const proc = this.ensureProcess();
        const id = this.nextId++;
        const payload = JSON.stringify({
            id,
            mode,
            texts,
        });
        return await new Promise((resolve, reject) => {
            const isColdStartRequest = !this.hasCompletedRequest && !this.hasColdStartTimedOut;
            const timeoutMs = !isColdStartRequest
                ? resolveTimeoutOverride("MEMX_LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS", LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS)
                : resolveTimeoutOverride("MEMX_LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS", LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS);
            const timer = setTimeout(() => {
                this.pending.delete(id);
                if (isColdStartRequest) {
                    this.hasColdStartTimedOut = true;
                }
                reject(new LocalEmbeddingTimeoutError(`local sentence-transformers request timed out (${mode}, ${timeoutMs}ms)`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            const ok = proc.stdin.write(`${payload}\n`);
            if (!ok) {
                proc.stdin.once("drain", () => undefined);
            }
        });
    }
    ensureProcess() {
        if (this.closed) {
            throw new Error("local sentence-transformers worker is closed");
        }
        if (this.proc && !this.proc.killed) {
            return this.proc;
        }
        const args = [
            resolveLocalWorkerPath(),
            "--model",
            resolveLocalModel(this.config),
            "--device",
            resolveLocalDevice(this.config),
        ];
        if (this.config.localCacheDir?.trim()) {
            args.push("--cache-dir", this.config.localCacheDir.trim());
        }
        const proc = spawn(resolveLocalPythonBin(this.config), args, {
            stdio: ["pipe", "pipe", "pipe"],
        });
        proc.stdout.setEncoding("utf8");
        proc.stderr.setEncoding("utf8");
        proc.stdout.on("data", (chunk) => {
            this.consumeStdout(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        });
        proc.stderr.on("data", (chunk) => {
            this.lastError =
                `${this.lastError}${typeof chunk === "string" ? chunk : chunk.toString("utf8")}`.slice(-4000);
        });
        proc.on("error", (error) => {
            this.failAll(new LocalEmbeddingHardFailureError(`local sentence-transformers worker failed to start: ${String(error)}`));
            this.proc = null;
        });
        proc.on("close", (code) => {
            const suffix = this.lastError.trim() ? `; stderr: ${this.lastError.trim()}` : "";
            this.failAll(new LocalEmbeddingHardFailureError(`local sentence-transformers worker exited with code ${code ?? -1}${suffix}`));
            this.proc = null;
        });
        this.proc = proc;
        return proc;
    }
    async close() {
        this.closed = true;
        const proc = this.proc;
        this.proc = null;
        this.buffer = "";
        this.failAll(new Error("local sentence-transformers worker closed"));
        if (!proc || proc.killed) {
            return;
        }
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(killTimer);
                proc.off("close", finish);
                proc.off("error", finish);
                resolve();
            };
            const killTimer = setTimeout(() => {
                if (!proc.killed) {
                    proc.kill("SIGKILL");
                }
                finish();
            }, 5_000);
            proc.once("close", finish);
            proc.once("error", finish);
            try {
                proc.stdin.end();
            }
            catch {
                // The worker may already be exiting.
            }
            proc.kill("SIGTERM");
        });
    }
    consumeStdout(chunk) {
        this.buffer += chunk;
        while (true) {
            const newline = this.buffer.indexOf("\n");
            if (newline === -1) {
                break;
            }
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (!line) {
                continue;
            }
            try {
                const response = JSON.parse(line);
                const pending = this.pending.get(response.id);
                if (!pending) {
                    if (!response.error && response.embeddings) {
                        this.hasCompletedRequest = true;
                    }
                    continue;
                }
                clearTimeout(pending.timer);
                this.pending.delete(response.id);
                if (response.error) {
                    pending.reject(new LocalEmbeddingHardFailureError(response.error));
                    continue;
                }
                this.hasCompletedRequest = true;
                pending.resolve(response.embeddings ?? []);
            }
            catch (error) {
                this.logger.warn(`memory-memx: failed to parse local embedding worker output (${String(error)})`);
            }
        }
    }
    failAll(error) {
        for (const [id, pending] of this.pending.entries()) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}
async function embedTextsRemote(config, texts) {
    if (config.provider === "openai-compatible") {
        const url = `${config.baseURL?.replace(/\/$/, "") ?? ""}/embeddings`;
        const body = {
            model: config.model,
            input: texts,
            ...(config.dimensions ? { dimensions: config.dimensions } : {}),
        };
        const headers = {
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
        }));
        return (json.data ?? []).map((entry) => entry.embedding ?? []);
    }
    const vectors = await Promise.all(texts.map(async (text) => {
        const url = `${config.ollamaBaseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434"}/api/embeddings`;
        const json = (await fetchJson(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: config.ollamaModel ?? config.model,
                prompt: text,
            }),
        }));
        return json.embedding ?? [];
    }));
    return vectors;
}
export class OptionalEmbeddingBackend {
    repo;
    embedding;
    logger;
    lexical;
    localWorker;
    warnedUnavailable = false;
    acceptingUpserts = true;
    localUnavailableForProcess = false;
    closed = false;
    upsertQueue = Promise.resolve();
    constructor(repo, embedding, logger) {
        this.repo = repo;
        this.embedding = embedding;
        this.logger = logger;
        this.lexical = new SqliteFtsBackend(repo);
        this.localWorker =
            embedding.provider === "sentence-transformers-local"
                ? new LocalSentenceTransformerWorker(embedding, logger)
                : null;
    }
    upsertDocs(docs) {
        this.repo.upsertDocs(docs);
        if (this.embedding.provider === "off" ||
            !this.acceptingUpserts ||
            this.closed ||
            this.isEmbeddingDisabledForProcess()) {
            return;
        }
        const eligibleDocs = docs.filter((doc) => doc.text.trim().length > 0);
        if (eligibleDocs.length === 0) {
            return;
        }
        this.upsertQueue = this.upsertQueue
            .then(async () => {
            const vectors = await this.embedTexts(eligibleDocs.map((doc) => doc.text), "passage", "vector-upsert");
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
            this.handleEmbeddingFailure(error, `memory-memx: embeddings unavailable, using lexical retrieval only (${String(error)})`);
        });
    }
    async flushPendingUpserts() {
        let pending = this.upsertQueue;
        while (true) {
            await pending;
            if (pending === this.upsertQueue) {
                return;
            }
            pending = this.upsertQueue;
        }
    }
    async close() {
        if (this.closed) {
            return;
        }
        this.acceptingUpserts = false;
        await this.flushPendingUpserts();
        this.closed = true;
        await this.localWorker?.close();
    }
    deleteDocs(docIds) {
        this.repo.deleteDocs(docIds);
    }
    keywordSearch(params) {
        return this.lexical.keywordSearch(params);
    }
    async similaritySearch(params) {
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
            const hits = [];
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
        }
        catch (error) {
            this.handleEmbeddingFailure(error, `memory-memx: similarity search failed, falling back to FTS (${String(error)})`);
            return [];
        }
    }
    async hybridSearch(params) {
        const keywordHits = this.keywordSearch(params);
        const similarityHits = await this.similaritySearch(params);
        return mergeHybridHits(params.query, keywordHits, similarityHits, params.limit);
    }
    async embedTextsBatch(texts, mode = "passage") {
        if (this.isEmbeddingDisabledForProcess()) {
            return [];
        }
        try {
            return await this.embedTexts(texts, mode, "batch");
        }
        catch (error) {
            this.handleEmbeddingFailure(error, `memory-memx: embedding batch unavailable, using lexical fallback (${String(error)})`);
            return [];
        }
    }
    isEmbeddingDisabledForProcess() {
        return this.embedding.provider === "sentence-transformers-local" && this.localUnavailableForProcess;
    }
    handleEmbeddingFailure(error, message) {
        this.warnOnce(message);
        if (this.embedding.provider !== "sentence-transformers-local" ||
            error instanceof LocalEmbeddingTimeoutError) {
            return;
        }
        this.localUnavailableForProcess = true;
        this.acceptingUpserts = false;
        void this.localWorker?.close().catch((error) => {
            this.logger.debug?.(`memory-memx: failed to close unavailable local embedding worker (${String(error)})`);
        });
    }
    warnOnce(message) {
        if (this.warnedUnavailable) {
            return;
        }
        this.warnedUnavailable = true;
        this.logger.warn(message);
    }
    async embedTexts(texts, mode, label) {
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
        }
        finally {
            const elapsedMs = Math.max(0, Date.now() - started);
            this.logger.info?.(`memory-memx: TIMING embedding label=${label} mode=${mode} batch=${texts.length} provider=${this.embedding.provider} elapsed=${elapsedMs}ms`);
        }
    }
}
