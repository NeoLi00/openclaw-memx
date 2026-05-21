const MEMX_NATIVE_HOOK_TIMEOUT_MS = 8 * 1e3;
const MEMX_NATIVE_HOOK_COMPILER_RESERVE_MS = 1500;
const MEMX_TRANSCRIPT_CAPTURE_TIMEOUT_MS = 1200;
function finitePositive(value) {
	return Number.isFinite(value) && value > 0 ? value : MEMX_NATIVE_HOOK_TIMEOUT_MS;
}
function deriveNativeHookHttpTimeoutMs(hookTimeoutMs) {
	return Math.max(250, finitePositive(hookTimeoutMs) - 500);
}
function deriveNativeHookQueryCompilerTimeoutMs(httpTimeoutMs) {
	return Math.max(250, finitePositive(httpTimeoutMs) - MEMX_NATIVE_HOOK_COMPILER_RESERVE_MS);
}
//#endregion
export { MEMX_NATIVE_HOOK_TIMEOUT_MS, MEMX_TRANSCRIPT_CAPTURE_TIMEOUT_MS, deriveNativeHookHttpTimeoutMs, deriveNativeHookQueryCompilerTimeoutMs };
