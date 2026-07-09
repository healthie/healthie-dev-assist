import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { dirname } from "path";
import {
  buildSchema,
  buildClientSchema,
  getIntrospectionQuery,
  printSchema,
  GraphQLSchema,
  IntrospectionQuery,
} from "graphql";
import { config } from "../config.js";

let cachedSchema: GraphQLSchema | null = null;
let cachedSdl: string | null = null;

/** Schema is considered stale after this many days */
const STALENESS_THRESHOLD_DAYS = 3;

export function getSchemaPath(): string {
  return config.schemaPath;
}

export function ensureSchemaDirExists(): void {
  const dir = dirname(config.schemaPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function schemaExists(): boolean {
  return existsSync(config.schemaPath);
}

/** Returns the age of the schema file in days, or Infinity if it doesn't exist. */
export function schemaAgeDays(): number {
  if (!schemaExists()) return Infinity;
  const mtime = statSync(config.schemaPath).mtime;
  return (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
}

/** Returns true if the schema file is older than the staleness threshold. */
export function schemaIsStale(): boolean {
  return schemaAgeDays() > STALENESS_THRESHOLD_DAYS;
}

export function loadSdl(): string {
  if (cachedSdl) return cachedSdl;

  if (!schemaExists()) {
    throw new Error(
      `Schema not found at ${config.schemaPath}. Run: npm run regenerate-schema`
    );
  }

  cachedSdl = readFileSync(config.schemaPath, "utf-8");
  return cachedSdl;
}

export function loadSchema(): GraphQLSchema {
  if (cachedSchema) return cachedSchema;

  const sdl = loadSdl();
  cachedSchema = buildSchema(sdl);
  return cachedSchema;
}

/** Clear cached schema so the next loadSdl/loadSchema call re-reads from disk. */
export function invalidateCache(): void {
  cachedSchema = null;
  cachedSdl = null;
}

/**
 * Recursively null out `defaultValue` on every input field and argument in an
 * introspection result. Works on a deep clone so the input is left untouched.
 */
function stripDefaultValues(data: IntrospectionQuery): IntrospectionQuery {
  const clone = structuredClone(data);
  for (const type of clone.__schema.types) {
    const inputFields = (type as { inputFields?: Array<{ defaultValue?: unknown }> }).inputFields;
    if (Array.isArray(inputFields)) {
      for (const field of inputFields) field.defaultValue = null;
    }
    const fields = (type as { fields?: Array<{ args?: Array<{ defaultValue?: unknown }> }> }).fields;
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (Array.isArray(field.args)) {
          for (const arg of field.args) arg.defaultValue = null;
        }
      }
    }
  }
  return clone;
}

/**
 * Fetch the schema from the live Healthie API via introspection and save it to disk.
 * Invalidates the in-memory cache so subsequent calls use the fresh schema.
 */
export async function regenerateSchema(): Promise<{ lines: number; path: string }> {
  const introspectionQuery = getIntrospectionQuery();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Basic ${config.apiKey}`,
  };
  if (config.authorizationShard) {
    headers["AuthorizationShard"] = config.authorizationShard;
  }

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: introspectionQuery }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} from ${config.apiUrl}: ${text}`);
  }

  const json = (await response.json()) as {
    data?: IntrospectionQuery;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`Introspection errors: ${messages}`);
  }

  if (!json.data) {
    throw new Error("No data returned from introspection query");
  }

  let sdl: string;
  try {
    sdl = printSchema(buildClientSchema(json.data));
  } catch (err) {
    // graphql-js' printSchema/astFromValue can't serialize some default values
    // (e.g. an empty-object `{}` default on a custom-scalar input field), which
    // throws "Cannot convert value to AST". Default values aren't needed for the
    // schema-as-reference use case, so strip them and retry.
    if (err instanceof Error && /convert value to AST/.test(err.message)) {
      const stripped = stripDefaultValues(json.data);
      sdl = printSchema(buildClientSchema(stripped));
      console.warn(
        "Note: dropped some un-serializable input default values while printing the schema."
      );
    } else {
      throw err;
    }
  }

  ensureSchemaDirExists();
  writeFileSync(config.schemaPath, sdl, "utf-8");

  // Clear in-memory cache so the fresh schema is picked up
  invalidateCache();

  return { lines: sdl.split("\n").length, path: config.schemaPath };
}

