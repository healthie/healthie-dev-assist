import {
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLEnumType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLScalarType,
  GraphQLNamedType,
  GraphQLField,
  GraphQLInputField,
  isNamedType,
  getNamedType,
} from "graphql";
import { loadSchema, loadSdl } from "./schema.js";
import { config } from "../config.js";

// ── Type helpers ─────────────────────────────────────────────────────────────

function typeToString(type: unknown): string {
  if (type && typeof type === "object" && "toString" in type) {
    return (type as { toString(): string }).toString();
  }
  return String(type);
}

function fieldToFieldDef(
  field: GraphQLField<unknown, unknown> | GraphQLInputField
): FieldDef {
  const base: FieldDef = {
    name: field.name,
    type: typeToString(field.type),
    description: field.description ?? undefined,
  };

  // GraphQLField (not GraphQLInputField) has deprecationReason and args
  const gqlField = field as GraphQLField<unknown, unknown>;
  if (gqlField.deprecationReason !== undefined) {
    base.isDeprecated = true;
    base.deprecationReason = gqlField.deprecationReason ?? undefined;
  }
  if (Array.isArray(gqlField.args) && gqlField.args.length > 0) {
    base.args = gqlField.args.map((a) => ({
      name: a.name,
      type: typeToString(a.type),
      description: a.description ?? undefined,
      defaultValue:
        a.defaultValue !== undefined ? String(a.defaultValue) : undefined,
    }));
  }

  return base;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  kind?: "type" | "field" | "query" | "mutation";
  limit?: number;
}

export interface SearchResult {
  name: string;
  kind: string;
  description?: string;
  parentType?: string;
  matchedFields?: string[];
}

export async function search(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const schema = loadSchema();
  const { kind, limit = 20 } = options;
  const q = query.toLowerCase();
  const results: Array<SearchResult & { score: number }> = [];

  const typeMap = schema.getTypeMap();

  for (const [typeName, type] of Object.entries(typeMap)) {
    // Skip built-in types
    if (typeName.startsWith("__")) continue;

    const isQuery = typeName === "Query";
    const isMutation = typeName === "Mutation";

    // Filter by kind
    if (kind === "type" && (isQuery || isMutation)) continue;
    if (kind === "query" && !isQuery) continue;
    if (kind === "mutation" && !isMutation) continue;
    if (kind === "field") {
      // Field search: look inside types
      if (
        type instanceof GraphQLObjectType ||
        type instanceof GraphQLInputObjectType
      ) {
        const fields = type.getFields();
        for (const [fieldName, field] of Object.entries(fields)) {
          if (fieldName.toLowerCase().includes(q)) {
            results.push({
              name: fieldName,
              kind: isQuery ? "QUERY" : isMutation ? "MUTATION" : "FIELD",
              description: field.description ?? undefined,
              parentType: typeName,
              score: fieldName.toLowerCase() === q ? 10 : 1,
            });
          }
        }
      }
      continue;
    }

    // Type-level matching
    const nameMatch = typeName.toLowerCase().includes(q);
    const descMatch = type.description?.toLowerCase().includes(q) ?? false;

    // For Query/Mutation root types, search their fields
    if (isQuery || isMutation) {
      const rootType = type as GraphQLObjectType;
      const fields = rootType.getFields();
      const matched: string[] = [];

      for (const [fieldName, field] of Object.entries(fields)) {
        if (
          fieldName.toLowerCase().includes(q) ||
          field.description?.toLowerCase().includes(q)
        ) {
          matched.push(fieldName);
        }
      }

      for (const fieldName of matched) {
        const field = fields[fieldName];
        results.push({
          name: fieldName,
          kind: isQuery ? "QUERY" : "MUTATION",
          description: field.description ?? undefined,
          parentType: typeName,
          score: fieldName.toLowerCase() === q ? 10 : 1,
        });
      }
      continue;
    }

    // Regular type matching
    const matchedFields: string[] = [];

    if (
      type instanceof GraphQLObjectType ||
      type instanceof GraphQLInputObjectType ||
      type instanceof GraphQLInterfaceType
    ) {
      const fields = type.getFields();
      for (const fieldName of Object.keys(fields)) {
        if (
          fieldName.toLowerCase().includes(q) &&
          !nameMatch // only report matched fields when parent doesn't fully match
        ) {
          matchedFields.push(fieldName);
        }
      }
    }

    if (nameMatch || descMatch || matchedFields.length > 0) {
      let kindStr = "OBJECT";
      if (type instanceof GraphQLInputObjectType) kindStr = "INPUT_OBJECT";
      else if (type instanceof GraphQLEnumType) kindStr = "ENUM";
      else if (type instanceof GraphQLInterfaceType) kindStr = "INTERFACE";
      else if (type instanceof GraphQLUnionType) kindStr = "UNION";
      else if (type instanceof GraphQLScalarType) kindStr = "SCALAR";

      const score =
        typeName.toLowerCase() === q
          ? 10
          : nameMatch
            ? 5
            : matchedFields.length > 0
              ? 2
              : 1;

      results.push({
        name: typeName,
        kind: kindStr,
        description: type.description ?? undefined,
        matchedFields: matchedFields.length > 0 ? matchedFields : undefined,
        score,
      });
    }
  }

  // Sort by score desc, then alphabetically
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return results.slice(0, limit).map(({ score: _score, ...r }) => r);
}

// ── Introspect ────────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  type: string;
  description?: string;
  isDeprecated?: boolean;
  deprecationReason?: string;
  args?: ArgDef[];
}

export interface ArgDef {
  name: string;
  type: string;
  description?: string;
  defaultValue?: string;
}

export interface TypeDetails {
  name: string;
  kind: string;
  description?: string;
  fields?: FieldDef[];
  inputFields?: FieldDef[];
  enumValues?: string[];
  interfaces?: string[];
  possibleTypes?: string[];
  /** Set when options.limit truncated results */
  totalFields?: number;
}

export interface IntrospectOptions {
  /** Only return these specific field names */
  fields?: string[];
  /** Return only the first N fields (useful for large types like User with 455 fields) */
  limit?: number;
}

export async function introspect(
  typeName: string,
  options: IntrospectOptions = {}
): Promise<TypeDetails> {
  const schema = loadSchema();
  const type = schema.getType(typeName);

  if (!type) {
    // Try case-insensitive match
    const typeMap = schema.getTypeMap();
    const match = Object.keys(typeMap).find(
      (k) => k.toLowerCase() === typeName.toLowerCase()
    );
    if (match) {
      return introspect(match, options);
    }
    throw new Error(`Type "${typeName}" not found in schema`);
  }

  const result: TypeDetails = {
    name: type.name,
    kind: "UNKNOWN",
    description: type.description ?? undefined,
  };

  function applyFieldOptions(allFields: FieldDef[]): FieldDef[] {
    let filtered = allFields;
    if (options.fields?.length) {
      const want = new Set(options.fields.map((f) => f.toLowerCase()));
      filtered = allFields.filter((f) => want.has(f.name.toLowerCase()));
    }
    if (options.limit !== undefined && filtered.length > options.limit) {
      result.totalFields = allFields.length;
      return filtered.slice(0, options.limit);
    }
    return filtered;
  }

  if (type instanceof GraphQLObjectType) {
    result.kind = "OBJECT";
    const all = Object.values(type.getFields()).map(fieldToFieldDef);
    result.fields = applyFieldOptions(all);
    if (result.totalFields === undefined && options.limit === undefined) {
      // no truncation — surface total for awareness on large types
      if (all.length > 50) result.totalFields = all.length;
    }
    result.interfaces = type.getInterfaces().map((i) => i.name);
  } else if (type instanceof GraphQLInputObjectType) {
    result.kind = "INPUT_OBJECT";
    const all = Object.values(type.getFields()).map(fieldToFieldDef);
    result.inputFields = applyFieldOptions(all);
    if (all.length > 50 && options.limit === undefined) result.totalFields = all.length;
  } else if (type instanceof GraphQLEnumType) {
    result.kind = "ENUM";
    result.enumValues = type.getValues().map((v) => v.name);
  } else if (type instanceof GraphQLInterfaceType) {
    result.kind = "INTERFACE";
    result.fields = applyFieldOptions(
      Object.values(type.getFields()).map(fieldToFieldDef)
    );
    result.possibleTypes = schema.getPossibleTypes(type).map((t) => t.name);
  } else if (type instanceof GraphQLUnionType) {
    result.kind = "UNION";
    result.possibleTypes = type.getTypes().map((t) => t.name);
  } else if (type instanceof GraphQLScalarType) {
    result.kind = "SCALAR";
  }

  return result;
}

// ── Schema ────────────────────────────────────────────────────────────────────

export async function getSchema(): Promise<string> {
  return loadSdl();
}

// ── GraphQL execution ─────────────────────────────────────────────────────────

async function executeGraphQL<T>(
  operation: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  if (!config.apiKey) {
    throw new Error(
      "HEALTHIE_API_KEY is required to execute queries/mutations. Set it in .env or environments.json."
    );
  }

  const body = JSON.stringify({ query: operation, variables });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Basic ${config.apiKey}`,
    AuthorizationSource: "API",
  };
  if (config.authorizationShard) {
    headers["AuthorizationShard"] = config.authorizationShard;
  }

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL errors: ${messages}`);
  }

  return json.data as T;
}

export async function query<T = unknown>(
  graphql: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return executeGraphQL<T>(graphql, variables);
}

export async function mutate<T = unknown>(
  graphql: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return executeGraphQL<T>(graphql, variables);
}

// ── Healthie API object (injected into sandbox) ───────────────────────────────

export function createHealthieApi(signal?: AbortSignal) {
  return {
    search,
    introspect,
    schema: getSchema,
    query: <T = unknown>(graphql: string, variables?: Record<string, unknown>) =>
      executeGraphQL<T>(graphql, variables, signal),
    mutate: <T = unknown>(graphql: string, variables?: Record<string, unknown>) =>
      executeGraphQL<T>(graphql, variables, signal),
  };
}

export const healthieApi = createHealthieApi();
