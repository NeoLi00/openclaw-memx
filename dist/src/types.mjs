const MEMORY_SCOPE_TEMPLATES = [
	"global",
	"agent:{agentId}",
	"session:{sessionKey}",
	"project:{project}"
];
const MEMORY_PII_MODES = [
	"off",
	"redact",
	"allow"
];
const MEMORY_CONSENT_MODES = [
	"explicit",
	"implicit",
	"off"
];
const MEMORY_EMBEDDING_PROVIDERS = [
	"off",
	"openai-compatible",
	"ollama",
	"sentence-transformers-local"
];
//#endregion
export { MEMORY_CONSENT_MODES, MEMORY_EMBEDDING_PROVIDERS, MEMORY_PII_MODES, MEMORY_SCOPE_TEMPLATES };
