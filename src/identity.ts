export const MEMX_BRAND_NAME = "memX";
export const MEMX_PLUGIN_ID = "memx";
export const LEGACY_MEMX_PLUGIN_ID = "memory-memx";
export const MEMX_REPOSITORY_SPEC = "github:NeoLi00/memX";
export const MEMX_REPOSITORY_URL = "https://github.com/NeoLi00/memX";
export const MEMX_NPM_PACKAGE = "@neoli00/memx";

export function withoutLegacyPluginIds(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => value !== LEGACY_MEMX_PLUGIN_ID);
}
