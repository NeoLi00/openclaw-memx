export declare function projectIdentityKey(value: string): string;
export declare function projectNamesMatch(left: string, right: string): boolean;
export declare function looksLikeProjectDescriptor(value: string): boolean;
export declare function projectAliasVariants(value: string): string[];
export declare function resolveProjectReference(value: string, params: {
    currentProject?: string;
    knownProjects?: string[];
    allowDescriptorAlias?: boolean;
}): string;
export declare function isProjectProfileStateKey(key: string): boolean;
export declare function projectCodeFromStateKey(key: string): string | undefined;
