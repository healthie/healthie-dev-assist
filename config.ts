import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, ".env") });

export interface EnvConfig {
  apiUrl: string;
  /** API key — required for query/mutate, optional for schema-only operations */
  apiKey: string;
  schemaPath: string;
  envName: string;
  /** Shard authorization ID — required only if your data is in a shard environment */
  authorizationShard?: string;
}

const API_URLS: Record<string, string> = {
  staging: "https://staging-api.gethealthie.com/graphql",
};

function loadConfig(): EnvConfig {
  const envName = process.env.HEALTHIE_ENV ?? "staging";
  const schemasDir = resolve(__dirname, "schemas");
  const schemaPath = resolve(schemasDir, `${envName}.graphql`);

  // Try environments.json first (multi-env support)
  const envFilePath = process.env.ENVIRONMENTS_FILE
    ? resolve(process.env.ENVIRONMENTS_FILE)
    : resolve(__dirname, "environments.json");

  if (existsSync(envFilePath)) {
    const envFile = JSON.parse(readFileSync(envFilePath, "utf-8"));
    const envEntry = envFile[envName];
    if (envEntry) {
      return {
        apiUrl: envEntry.apiUrl,
        apiKey: envEntry.apiKey,
        schemaPath,
        envName,
        authorizationShard: envEntry.authorizationShard || undefined,
      };
    }
  }

  // Fall back to env vars
  // API key is optional — schema search/introspect work without it.
  // query() and mutate() will throw at call time if the key is missing.
  const apiKey = process.env.HEALTHIE_API_KEY ?? "";
  const authorizationShard = process.env.HEALTHIE_AUTHORIZATION_SHARD || undefined;

  const apiUrl = API_URLS[envName];
  if (!apiUrl) {
    throw new Error(
      `Unknown HEALTHIE_ENV: "${envName}". Valid values: ${Object.keys(API_URLS).join(", ")}`
    );
  }

  return { apiUrl, apiKey, schemaPath, envName, authorizationShard };
}

export const config = loadConfig();
