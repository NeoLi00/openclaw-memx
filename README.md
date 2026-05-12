<p align="center">
  <img src="./assets/memx-architecture.svg" alt="MemX architecture" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>Long-term agent memory with self-learning, self-maintenance, and relationship-aware recall.</strong>
</p>

<p align="center">
  Contact: <a href="mailto:neoliriven@gmail.com">neoliriven@gmail.com</a>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
</p>

---

MemX is a local-first long-term memory plugin for OpenClaw. It helps agents keep working with you
across days, projects, decisions, corrections, and evolving preferences.

**What it adds:** stable work memory, task state, relationship recall, learned habits, automatic
cleanup, and compact evidence injection.

## What it can do

### Remember work over time

MemX keeps the useful parts of long conversations: project decisions, user preferences, task status,
important events, and raw evidence. Long inputs and long agent replies are split into linked segments
so precise slices can be recalled without losing the original turn.

---

### Connect related things

MemX includes relationship-aware memory. It can keep track of how projects, repos, tools, people,
resources, blockers, and outcomes relate to each other. When the same object is mentioned with
different names, MemX can use aliases and identity evidence to keep the memory connected.

Example: if a project is later called "Raven API", "the auth repo", or just "Raven", MemX can keep
those references tied together when the evidence supports it.

---

### Learn from repeated collaboration

MemX can notice stable patterns across repeated work. For example, it can learn that you prefer small
reversible patches, that a certain project needs API checks before UI work, or that a recurring task
usually follows the same review flow.

These learned patterns remain tied to supporting evidence. They are not loose summaries with no
source.

---

### Maintain itself

MemX continuously keeps memory usable:

- repeated evidence can become a stable memory;
- corrected information can replace older information;
- old task state can stop competing with current state;
- high-level summaries can point back to raw evidence;
- noisy control turns such as OpenClaw heartbeat checks are ignored.

The result is a memory store that evolves with the work instead of becoming a stale transcript.

---

### Recall useful evidence

When the agent needs memory, MemX does not dump everything into the prompt. It searches across
facts, events, state, chunks, relationships, resources, and learned patterns, then builds compact
evidence lines for the current question.

The agent sees what matters now, with enough source context to answer reliably.

## Evaluation signal

In the current internal long-running engineering-memory replay suite, MemX reached **100% recall of
the expected memory evidence**. That means the expected evidence was written, retrievable, and
available to prompt injection in the tested scenarios.

## Install

Requirements: OpenClaw 2026.4.25+ with Node.js 22.14+ or Node 24. Python 3 is required only for
local sentence-transformers embeddings.

Follow these steps in order. Run the clone and plugin install only once.

### 1. Make sure OpenClaw has an LLM provider

MemX can reuse any compatible OpenClaw model provider. If OpenClaw already has one, keep its model
name handy as `provider/model` and skip to step 2.

For a fresh OpenClaw install, configure a provider first. The example below uses DeepSeek V4 Flash
only as an example; you can use any compatible provider/model.

```bash
openclaw config set models.providers.deepseek '{
  "api": "openai-completions",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-your-deepseek-key",
  "models": [
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "api": "openai-completions",
      "reasoning": false,
      "input": ["text"],
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
      "contextWindow": 64000,
      "maxTokens": 8192
    }
  ]
}' --strict-json
```

After this example, the model name for MemX is `deepseek/deepseek-v4-flash`.

If you prefer not to store the API key directly in `~/.openclaw/openclaw.json`, use an environment
variable template in the same provider config:

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
```

Then set `"apiKey": "${DEEPSEEK_API_KEY}"` in the provider JSON and make sure the Gateway process
has that environment variable.

### 2. Clone and install MemX

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx
openclaw plugins install .
```

For local development with live edits, use the link form instead of the last command:

```bash
openclaw plugins install --link .
```

### 3. Set up local embeddings

```bash
python3 -m venv "$HOME/.openclaw/memx/.venv"
"$HOME/.openclaw/memx/.venv/bin/python" -m pip install -U pip sentence-transformers torch
```

This installs the Python dependencies used by the recommended local embedding provider.

### 4. Write the MemX config

Replace `provider/model` with your OpenClaw model, for example `deepseek/deepseek-v4-flash`.

```bash
openclaw memx setup \
  --local-embedding \
  --embedding-python "$HOME/.openclaw/memx/.venv/bin/python" \
  --llm-model provider/model
```

You may omit `--llm-model provider/model` only if you want MemX to use OpenClaw's current default
model.

### 5. Restart and verify

```bash
openclaw gateway restart
openclaw memx doctor --deep
```

## Embedding options

The install flow above uses the recommended local embedding setup. To use a different embedding
provider, replace step 3 and step 4 with one of the options below, then run step 5.

### Local sentence-transformers with a custom model

```bash
python3 -m venv "$HOME/.openclaw/memx/.venv"
"$HOME/.openclaw/memx/.venv/bin/python" -m pip install -U pip sentence-transformers torch

openclaw memx setup \
  --embedding-provider sentence-transformers-local \
  --embedding-model BAAI/bge-m3 \
  --embedding-python "$HOME/.openclaw/memx/.venv/bin/python" \
  --embedding-device auto \
  --llm-model provider/model
```

### OpenAI-compatible embeddings

```bash
openclaw memx setup \
  --embedding-provider openai-compatible \
  --embedding-model text-embedding-3-small \
  --llm-model provider/model
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey "sk-your-embedding-key"
```

### Ollama embeddings

```bash
openclaw memx setup \
  --embedding-provider ollama \
  --embedding-model nomic-embed-text \
  --llm-model provider/model
openclaw config set plugins.entries.memory-memx.config.embedding.ollamaBaseURL http://127.0.0.1:11434
```

### No vector embeddings

```bash
openclaw memx setup --embedding-provider off --llm-model provider/model
```

This disables vector embeddings and uses lexical fallback only.

After changing embedding settings on an existing memory database, restart the Gateway and reindex:

```bash
openclaw gateway restart
openclaw memx reindex
```

## Recommended cost-quality setup

The following combination is recommended for a practical balance of cost, quality, multilingual
retrieval, and local-first operation:

| Layer | Recommended choice | Why |
| --- | --- | --- |
| LLM compiler | Any compatible OpenClaw LLM provider; DeepSeek V4 Flash is one low-cost example | Semantic planning with enough quality for memory compilation |
| Embedding | `intfloat/multilingual-e5-small` | Fast local multilingual retrieval with no embedding API bill |
