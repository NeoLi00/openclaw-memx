<p align="center">
  <img src="./assets/memx-architecture.svg" alt="MemX architecture" width="920">
</p>

<h1 align="center">MemX Memory for OpenClaw</h1>

<p align="center">
  <strong>Long-term agent memory with self-learning, self-maintenance, and relationship-aware recall.</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README-ch.md">中文</a>
</p>

---

MemX is a local-first long-term memory plugin for OpenClaw. It is built for agents that keep
working with you across days, projects, decisions, corrections, and evolving preferences.

Instead of storing a pile of notes, MemX helps an agent:

- remember stable facts, preferences, and working context;
- track active tasks, blockers, next steps, and resolved work;
- connect people, projects, tools, files, resources, and decisions;
- learn repeated working habits from ongoing collaboration;
- clean up stale or corrected memory so old context does not dominate;
- inject only the evidence that helps the current answer.

## What it can do

### Remember work over time

MemX keeps the useful parts of long conversations: project decisions, user preferences, task status,
important events, and raw evidence. Long inputs and long agent replies are split into linked segments
so precise slices can be recalled without losing the original turn.

### Connect related things

MemX includes relationship-aware memory. It can keep track of how projects, repos, tools, people,
resources, blockers, and outcomes relate to each other. When the same object is mentioned with
different names, MemX can use aliases and identity evidence to keep the memory connected.

Example: if a project is later called "Raven API", "the auth repo", or just "Raven", MemX can keep
those references tied together when the evidence supports it.

### Learn from repeated collaboration

MemX can notice stable patterns across repeated work. For example, it can learn that you prefer small
reversible patches, that a certain project needs API checks before UI work, or that a recurring task
usually follows the same review flow.

These learned patterns remain tied to supporting evidence. They are not loose summaries with no
source.

### Maintain itself

MemX continuously keeps memory usable:

- repeated evidence can become a stable memory;
- corrected information can replace older information;
- old task state can stop competing with current state;
- high-level summaries can point back to raw evidence;
- noisy control turns such as OpenClaw heartbeat checks are ignored.

The result is a memory store that evolves with the work instead of becoming a stale transcript.

### Recall useful evidence

When the agent needs memory, MemX does not dump everything into the prompt. It searches across
facts, events, state, chunks, relationships, resources, and learned patterns, then builds compact
evidence lines for the current question.

The agent sees what matters now, with enough source context to answer reliably.

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

