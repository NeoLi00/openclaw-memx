<p align="center">
  <img src="./assets/memx-architecture.svg" alt="MemX architecture" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>Self-learning, self-maintaining graph memory for long-running OpenClaw agents.</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
</p>

---

MemX is a local-first long-term memory plugin for OpenClaw. It is designed for agents that
work across days, projects, repos, decisions, corrections, and evolving user preferences.

It is not a single memory table. MemX is a multi-layer memory system with:

- **Graph memory** for entities, aliases, relationships, project identity, resources, and multi-hop recall.
- **Self-learning memory** for beliefs, signals, habits, strategies, and workflow patterns.
- **Self-maintaining memory** for consolidation, abstraction, supersession, promotion, decay, and source-traceable upgrades.
- **Evidence-grade recall** that injects compact, auditable prompt evidence instead of dumping raw memory.

The goal is to let an agent keep working with you over time: remember what changed, connect related
objects, learn repeated patterns, avoid stale state, and recover the right evidence when the current
task needs it.

## Why MemX exists

Most memory plugins are good at storing notes. Real agents need more:

- A project may be called by several names across weeks.
- A user may correct a prior fact.
- A task can move from active to blocked to resolved.
- A workflow habit may only become clear after repeated interactions.
- A graph relationship may matter more than any single sentence.
- Long engineering conversations need precise evidence, not fuzzy summaries.

MemX treats memory as an evolving system. It captures raw evidence, materializes canonical objects,
maintains graph and learning layers, and recalls only the evidence that helps the current turn.

## Core capabilities

### Graph memory

MemX tracks entities and relationships instead of relying only on text similarity.

- Entity mentions, aliases, and identity links are resolved into canonical entities.
- Graph edges connect people, projects, tools, repos, resources, locations, blockers, and outcomes.
- Query-time entity expansion can recall related facts, events, states, strategies, and graph paths.
- Old aliases can still route to the current canonical entity.

This is what lets an agent remember that "Raven", "Raven API", and "the auth repo" may refer to the
same project when the evidence supports that identity.

### Self-learning memory

MemX has a control layer for signals, beliefs, and strategy hypotheses.

- Retrieval support, contradictions, corrections, and outcomes are recorded as learning signals.
- Repeated evidence can form beliefs with lifecycle stages.
- Resolved task outcomes and explicit workflow guidance can become strategies.
- Beliefs and strategies are source-backed, not free-floating summaries.

This lets the agent learn durable working patterns such as "the user prefers small reversible patches"
or "this project usually needs API contract checks before UI changes", while still keeping source
evidence available.

### Self-maintaining memory

MemX maintenance is a fidelity upgrade layer, not a second raw-text parser.

- Consolidation turns repeated structured evidence into stable facts or graph edges.
- Abstraction jobs propose derived state, workflow patterns, graph hypotheses, and concepts.
- Promotion materializes durable objects only when lineage and support refs are available.
- Supersession and currentness logic keep stale facts, old blockers, and expired task state from
  dominating recall.

Maintenance preserves provenance so recall can expand from a high-level object back to raw evidence.

### Evidence-grade recall

MemX recall is compiler-guided and packet-based.

- Query compilation produces evidence goals, roles, and semantic bridges.
- Candidate generation searches facts, events, states, chunks, graph neighborhoods, resources, and
  strategies separately.
- Source expansion pulls raw support and neighboring context when needed.
- Evidence packets are ranked and packed into the prompt as compact, readable lines.

The agent gets usable evidence, not a noisy memory dump.

### Local-first hybrid search

MemX defaults to local embeddings using `sentence-transformers` and
`intfloat/multilingual-e5-small`.

- No embedding API key is required by default.
- If the local embedding runtime is cold or unavailable, MemX falls back to lexical retrieval.
- Long inputs and outputs are stored as linked source segments so precise slices can be recalled
  without losing the identity of the original turn.

### Heartbeat-safe capture

OpenClaw heartbeat and control turns are filtered so background liveness checks do not create memory,
trigger semantic compilation, or pollute maintenance.

## Memory layers

- **Scene layer**: turns, chunks, tasks, sessions, working continuity.
- **Canonical layer**: facts, states, events, entities, graph edges.
- **Control layer**: beliefs, signals, strategies, abstractions, promotion lifecycle.
- **Recall layer**: vector docs, candidate traces, source expansion, prompt evidence packets.

## Current evaluation signal

In the current internal long-running engineering-memory replay suite, MemX reached **100% recall of
the expected memory evidence**. That means the expected evidence was written, retrievable, and
available to prompt injection in the tested scenarios.

This is an evaluation signal for the current replay suite, not a universal guarantee for every future
workload.

## Installation

Requirements:

- OpenClaw with Node.js 22+
- `git`
- Python 3 for local sentence-transformers embeddings
- A configured OpenClaw LLM provider, or the DeepSeek example below

Clone and install:

```bash
git clone https://github.com/NeoLi00/openclaw-memx.git
cd openclaw-memx

openclaw plugins install .
openclaw plugins enable memory-memx
```

Install local embedding dependencies:

```bash
python3 -m pip install --user sentence-transformers torch
```

Configure DeepSeek V4 Flash as the OpenClaw model provider:

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"

openclaw config set models.providers.deepseek.api openai-completions
openclaw config set models.providers.deepseek.baseUrl https://api.deepseek.com
openclaw config set models.providers.deepseek.apiKey '${DEEPSEEK_API_KEY}'

openclaw config set agents.defaults.model.primary deepseek/deepseek-v4-flash
openclaw config set plugins.entries.memory-memx.config.advanced.llmClassifierModel deepseek/deepseek-v4-flash
```

Configure MemX with multilingual E5 local embeddings:

```bash
openclaw config set plugins.entries.memory-memx.config.enabled true
openclaw config set plugins.entries.memory-memx.config.autoCapture true
openclaw config set plugins.entries.memory-memx.config.autoRecall true
openclaw config set plugins.entries.memory-memx.config.reflectionEnabled true

openclaw config set plugins.entries.memory-memx.config.embedding.provider sentence-transformers-local
openclaw config set plugins.entries.memory-memx.config.embedding.model intfloat/multilingual-e5-small
openclaw config set plugins.entries.memory-memx.config.embedding.localDevice auto
```

Restart the OpenClaw gateway after installation or config changes:

```bash
openclaw gateway run --bind loopback --force
```

Verify:

```bash
openclaw plugins list
openclaw plugins info memory-memx
openclaw plugins doctor
```

## Provider key reuse

MemX does not need a separate LLM API key when OpenClaw already has a provider configured. It reads
the selected provider from OpenClaw config and reuses `models.providers.<provider>.apiKey` and custom
headers.

For embeddings, the default local provider does not need an API key. If you switch embeddings to
`openai-compatible`, configure the MemX embedding key separately:

```bash
openclaw config set plugins.entries.memory-memx.config.embedding.provider openai-compatible
openclaw config set plugins.entries.memory-memx.config.embedding.baseURL https://api.openai.com/v1
openclaw config set plugins.entries.memory-memx.config.embedding.apiKey '${OPENAI_API_KEY}'
openclaw config set plugins.entries.memory-memx.config.embedding.model text-embedding-3-small
```

