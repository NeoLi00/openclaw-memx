//#region src/identity.ts
const MEMX_BRAND_NAME = "memX";
const MEMX_PLUGIN_ID = "memx";
const LEGACY_MEMX_PLUGIN_ID = "memory-memx";
const MEMX_INSTALL_SPEC = "github:NeoLi00/memX";
function withoutLegacyPluginIds(values) {
	return (values ?? []).filter((value) => value !== LEGACY_MEMX_PLUGIN_ID);
}
//#endregion
export { LEGACY_MEMX_PLUGIN_ID, MEMX_BRAND_NAME, MEMX_INSTALL_SPEC, MEMX_PLUGIN_ID, withoutLegacyPluginIds };
