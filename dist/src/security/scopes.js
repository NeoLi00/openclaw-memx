export function renderTemplate(input, vars) {
    return input
        .replaceAll("{agentId}", vars.agentId ?? "")
        .replaceAll("{sessionKey}", vars.sessionKey ?? "")
        .replaceAll("{project}", vars.project ?? "")
        .replaceAll("{workspace}", vars.workspace ?? "");
}
export function resolveDefaultScope(config, vars) {
    return renderTemplate(config.defaultScope, vars).trim();
}
export function resolveAllowedScopes(config, vars) {
    const seen = new Set();
    for (const entry of config.allowedScopes) {
        const resolved = renderTemplate(entry, vars).trim();
        if (!resolved) {
            continue;
        }
        seen.add(resolved);
    }
    const defaultScope = resolveDefaultScope(config, vars);
    if (defaultScope) {
        seen.add(defaultScope);
    }
    return [...seen];
}
export function isScopeAllowed(scope, config, vars) {
    return resolveAllowedScopes(config, vars).includes(scope.trim());
}
export function defaultRetrievalScopes(config, vars) {
    const allowed = resolveAllowedScopes(config, vars);
    const scopes = new Set();
    for (const entry of allowed) {
        if (entry === "global") {
            scopes.add(entry);
        }
        if (vars.agentId && entry === `agent:${vars.agentId}`) {
            scopes.add(entry);
        }
        if (vars.sessionKey && entry === `session:${vars.sessionKey}`) {
            scopes.add(entry);
        }
        if (vars.project && entry === `project:${vars.project}`) {
            scopes.add(entry);
        }
    }
    const fallbackScope = resolveDefaultScope(config, vars);
    if (fallbackScope) {
        scopes.add(fallbackScope);
    }
    return [...scopes];
}
