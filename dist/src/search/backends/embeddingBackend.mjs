import { cosineSimilarity, orderByScore } from "../../support.mjs";
import { SqliteFtsBackend } from "./ftsBackend.mjs";
import { mergeHybridHits } from "./hybrid.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
//#region src/search/backends/embeddingBackend.ts
var LocalEmbeddingTimeoutError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "LocalEmbeddingTimeoutError";
	}
};
var LocalEmbeddingHardFailureError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "LocalEmbeddingHardFailureError";
	}
};
const DEFAULT_LOCAL_MODEL = "intfloat/multilingual-e5-small";
const DEFAULT_LOCAL_PYTHON_BIN = "python3";
const DEFAULT_LOCAL_DEVICE = "auto";
const LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS = 12e4;
const LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS = 3e5;
const LOCAL_WORKER_PATH = fileURLToPath(new URL("../../../sentence_transformers_embedder.py", import.meta.url));
async function fetchJson(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
	return response.json();
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
var LocalSentenceTransformerWorker = class {
	config;
	logger;
	nextId = 1;
	hasCompletedRequest = false;
	closed = false;
	child = null;
	stdoutLines = null;
	stderrBuffer = "";
	pending = /* @__PURE__ */ new Map();
	constructor(config, logger) {
		this.config = config;
		this.logger = logger;
	}
	async embed(texts, mode) {
		if (texts.length === 0) return [];
		if (this.closed) throw new Error("local sentence-transformers worker is closed");
		const id = this.nextId++;
		const payload = JSON.stringify({
			id,
			mode,
			texts
		});
		const timeoutMs = this.hasCompletedRequest ? LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS : LOCAL_EMBEDDING_COLD_START_TIMEOUT_MS;
		const child = this.ensureWorker();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				const error = new LocalEmbeddingTimeoutError(`local sentence-transformers request timed out (${mode}, ${timeoutMs}ms)`);
				this.stopWorker();
				reject(error);
			}, timeoutMs);
			this.pending.set(id, {
				resolve,
				reject,
				timer
			});
			child.stdin.write(`${payload}\n`, (error) => {
				if (!error) return;
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id);
				clearTimeout(pending.timer);
				reject(new LocalEmbeddingHardFailureError(String(error)));
			});
		});
	}
	async close() {
		this.closed = true;
		this.failPending(new LocalEmbeddingHardFailureError("local sentence-transformers worker closed"));
		await this.stopWorker();
	}
	ensureWorker() {
		if (this.closed) throw new Error("local sentence-transformers worker is closed");
		if (this.child && !this.child.killed) return this.child;
		const args = [
			LOCAL_WORKER_PATH,
			"--model",
			resolveLocalModel(this.config),
			"--device",
			resolveLocalDevice(this.config)
		];
		if (this.config.localCacheDir?.trim()) args.push("--cache-dir", this.config.localCacheDir.trim());
		const child = spawn(resolveLocalPythonBin(this.config), args, { stdio: [
			"pipe",
			"pipe",
			"pipe"
		] });
		this.child = child;
		this.stderrBuffer = "";
		const stdoutLines = createInterface({ input: child.stdout });
		this.stdoutLines = stdoutLines;
		stdoutLines.on("line", (line) => this.handleWorkerLine(line));
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4e3);
		});
		child.on("error", (error) => {
			this.failPending(new LocalEmbeddingHardFailureError(String(error)));
			this.child = null;
		});
		child.on("exit", (code, signal) => {
			if (this.child === child) {
				this.child = null;
				this.stdoutLines?.close();
				this.stdoutLines = null;
			} else stdoutLines.close();
			if (this.closed || this.pending.size === 0) return;
			const suffix = this.stderrBuffer.trim() ? `; stderr: ${this.stderrBuffer.trim()}` : "";
			this.failPending(new LocalEmbeddingHardFailureError(`local sentence-transformers worker exited with code ${code ?? -1}${signal ? ` signal ${signal}` : ""}${suffix}`));
		});
		return child;
	}
	handleWorkerLine(rawLine) {
		const line = rawLine.trim();
		if (!line) return;
		let response;
		try {
			response = JSON.parse(line);
		} catch (error) {
			this.logger.warn(`memory-memx: failed to parse local embedding worker output (${String(error)})`);
			this.failPending(new LocalEmbeddingHardFailureError(String(error)));
			this.stopWorker();
			return;
		}
		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);
		clearTimeout(pending.timer);
		if (response.error) {
			pending.reject(new LocalEmbeddingHardFailureError(response.error));
			return;
		}
		this.hasCompletedRequest = true;
		pending.resolve(response.embeddings ?? []);
	}
	failPending(error) {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}
	async stopWorker() {
		const child = this.child;
		this.child = null;
		this.stdoutLines?.close();
		this.stdoutLines = null;
		if (!child || child.killed) return;
		child.stdin.destroy();
		await new Promise((resolve) => {
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
};
async function embedTextsRemote(config, texts) {
	if (config.provider === "openai-compatible") {
		const url = `${config.baseURL?.replace(/\/$/, "") ?? ""}/embeddings`;
		const body = {
			model: config.model,
			input: texts,
			...config.dimensions ? { dimensions: config.dimensions } : {}
		};
		const headers = {
			"content-type": "application/json",
			...config.headers ?? {}
		};
		if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
		return ((await fetchJson(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body)
		})).data ?? []).map((entry) => entry.embedding ?? []);
	}
	return await Promise.all(texts.map(async (text) => {
		return (await fetchJson(`${config.ollamaBaseURL?.replace(/\/$/, "") ?? "http://127.0.0.1:11434"}/api/embeddings`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: config.ollamaModel ?? config.model,
				prompt: text
			})
		})).embedding ?? [];
	}));
}
var OptionalEmbeddingBackend = class {
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
		this.localWorker = embedding.provider === "sentence-transformers-local" ? new LocalSentenceTransformerWorker(embedding, logger) : null;
	}
	upsertDocs(docs) {
		this.repo.upsertDocs(docs);
		if (this.embedding.provider === "off" || !this.acceptingUpserts || this.closed || this.isEmbeddingDisabledForProcess()) return;
		const eligibleDocs = docs.filter((doc) => doc.text.trim().length > 0);
		if (eligibleDocs.length === 0) return;
		this.upsertQueue = this.upsertQueue.then(async () => {
			const vectors = await this.embedTexts(eligibleDocs.map((doc) => doc.text), "passage", "vector-upsert");
			if (this.closed) return;
			for (const [index, doc] of eligibleDocs.entries()) {
				const vector = vectors[index] ?? [];
				if (vector.length === 0) continue;
				this.repo.upsertEmbedding({
					docId: doc.docId,
					agentId: doc.agentId,
					scope: doc.scope,
					embedding: vector,
					updatedAt: doc.updatedAt
				});
			}
		}).catch((error) => {
			this.handleEmbeddingFailure(error, `memory-memx: embeddings unavailable, using lexical retrieval only (${String(error)})`);
		});
	}
	async flushPendingUpserts() {
		let pending = this.upsertQueue;
		while (true) {
			await pending;
			if (pending === this.upsertQueue) return;
			pending = this.upsertQueue;
		}
	}
	async close() {
		if (this.closed) return;
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
		if (this.embedding.provider === "off" || this.isEmbeddingDisabledForProcess()) return [];
		try {
			const [queryEmbedding] = await this.embedTexts([params.query], "query", "similarity-search");
			if (!queryEmbedding || queryEmbedding.length === 0) return [];
			const rows = this.repo.listEmbeddings({
				agentId: params.agentId,
				scopes: params.scopes,
				limit: Math.max(params.limit * 16, 128),
				readEpoch: params.readEpoch,
				docKinds: params.docKinds,
				docTypes: params.docTypes
			});
			const hits = [];
			for (const row of rows) {
				const score = cosineSimilarity(queryEmbedding, row.embedding);
				if (score <= 0) continue;
				const doc = this.repo.getDoc(row.docId, params.readEpoch);
				if (!doc) continue;
				hits.push({
					docId: doc.docId,
					text: doc.text,
					metadata: doc.metadataJson,
					score,
					backend: "embedding"
				});
			}
			return orderByScore(hits).slice(0, params.limit);
		} catch (error) {
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
		if (this.isEmbeddingDisabledForProcess()) return [];
		try {
			return await this.embedTexts(texts, mode, "batch");
		} catch (error) {
			this.handleEmbeddingFailure(error, `memory-memx: embedding batch unavailable, using lexical fallback (${String(error)})`);
			return [];
		}
	}
	isEmbeddingDisabledForProcess() {
		return this.embedding.provider === "sentence-transformers-local" && this.localUnavailableForProcess;
	}
	handleEmbeddingFailure(error, message) {
		this.warnOnce(message);
		if (this.embedding.provider !== "sentence-transformers-local" || error instanceof LocalEmbeddingTimeoutError) return;
		this.localUnavailableForProcess = true;
		this.acceptingUpserts = false;
		this.localWorker?.close().catch((error) => {
			this.logger.debug?.(`memory-memx: failed to close unavailable local embedding worker (${String(error)})`);
		});
	}
	warnOnce(message) {
		if (this.warnedUnavailable) return;
		this.warnedUnavailable = true;
		this.logger.warn(message);
	}
	async embedTexts(texts, mode, label) {
		if (this.embedding.provider === "off") throw new Error("embeddings disabled");
		if (this.isEmbeddingDisabledForProcess()) throw new Error("local embeddings unavailable for this process");
		const started = Date.now();
		try {
			if (this.embedding.provider === "sentence-transformers-local") {
				if (!this.localWorker) throw new Error("local sentence-transformers worker unavailable");
				return await this.localWorker.embed(texts, mode);
			}
			return await embedTextsRemote(this.embedding, texts);
		} finally {
			const elapsedMs = Math.max(0, Date.now() - started);
			this.logger.info?.(`memory-memx: TIMING embedding label=${label} mode=${mode} batch=${texts.length} provider=${this.embedding.provider} elapsed=${elapsedMs}ms`);
		}
	}
};
//#endregion
export { OptionalEmbeddingBackend };
