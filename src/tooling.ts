type JsonSchema = Record<string, unknown>;
type OptionalJsonSchema = JsonSchema & { __memxOptional?: true };

const OPTIONAL_MARKER = "__memxOptional";

export const Type = {
  String(): JsonSchema {
    return { type: "string" };
  },
  Number(): JsonSchema {
    return { type: "number" };
  },
  Boolean(): JsonSchema {
    return { type: "boolean" };
  },
  Optional(schema: JsonSchema): OptionalJsonSchema {
    return { ...schema, [OPTIONAL_MARKER]: true };
  },
  Object(properties: Record<string, OptionalJsonSchema>): JsonSchema {
    const cleanProperties = Object.fromEntries(
      Object.entries(properties).map(([key, schema]) => {
        const { [OPTIONAL_MARKER]: _optional, ...cleanSchema } = schema;
        return [key, cleanSchema];
      }),
    );
    const required = Object.entries(properties)
      .filter(([, schema]) => schema[OPTIONAL_MARKER] !== true)
      .map(([key]) => key);
    return {
      type: "object",
      properties: cleanProperties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  },
};

export function stringEnum<T extends readonly string[]>(values: T, description?: string) {
  return {
    type: "string",
    enum: [...values],
    ...(description ? { description } : {}),
  };
}

export function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}
