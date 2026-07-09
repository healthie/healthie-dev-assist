/**
 * Setup script: adds healthie-dev-assist to Claude Desktop's MCP config.
 * Handles migration from v1 (key in config env block) to v2 (key in .env file).
 * Run with: npm run setup
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const projectRoot = resolve(import.meta.dirname);
const tsxCliPath = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const serverEntryPath = resolve(projectRoot, "src", "server.ts");

// ── Locate Claude Desktop config ──────────────────────────────────────────────

function getConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return resolve(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      );
    case "win32":
      return resolve(
        process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"),
        "Claude",
        "claude_desktop_config.json"
      );
    default:
      return resolve(
        process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"),
        "Claude",
        "claude_desktop_config.json"
      );
  }
}

// ── Read existing config ───────────────────────────────────────────────────────

const configPath = getConfigPath();
let config: Record<string, unknown> = {};

if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    const backupPath = configPath + ".backup";
    writeFileSync(backupPath, readFileSync(configPath));
    console.error(
      `Could not parse existing config — backed up to ${backupPath}`
    );
    config = {};
  }
}

// ── Migrate API key from old config → .env ──────────────────────────────────

if (!config.mcpServers || typeof config.mcpServers !== "object") {
  config.mcpServers = {};
}

const mcpServers = config.mcpServers as Record<string, unknown>;

function migrateApiKey() {
  const dotEnvPath = resolve(projectRoot, ".env");
  const dotEnvExamplePath = resolve(projectRoot, ".env.example");

  // Check both possible old config keys for an API key in the env block
  for (const key of ["healthie-dev-assist", "healthie"]) {
    const entry = mcpServers[key] as
      | { env?: { HEALTHIE_API_KEY?: string } }
      | undefined;
    const oldKey = entry?.env?.HEALTHIE_API_KEY;
    if (!oldKey) continue;

    // Only migrate if .env is missing or still has the placeholder value
    if (existsSync(dotEnvPath)) {
      const dotEnvContent = readFileSync(dotEnvPath, "utf-8");
      if (
        dotEnvContent.includes("HEALTHIE_API_KEY=") &&
        !dotEnvContent.includes("your_api_key_here") &&
        !dotEnvContent.includes("your-api-key-here")
      ) {
        // .env already has a real key — don't overwrite
        return;
      }
    }

    // Write .env from template with the migrated key
    let envContent: string;
    if (existsSync(dotEnvExamplePath)) {
      envContent = readFileSync(dotEnvExamplePath, "utf-8");
      envContent = envContent.replace(
        /HEALTHIE_API_KEY=.*/,
        `HEALTHIE_API_KEY=${oldKey}`
      );
    } else {
      envContent = `HEALTHIE_API_KEY=${oldKey}\n`;
    }

    writeFileSync(dotEnvPath, envContent);
    console.log("Migrated API key from Claude Desktop config to .env");
    return;
  }
}

migrateApiKey();

// ── Update MCP config entry ──────────────────────────────────────────────────

const existing = mcpServers["healthie-dev-assist"];
// GUI hosts (e.g. Claude Desktop) run with a minimal PATH and are blocked by
// macOS from executing a shell script located under ~/Documents ("Operation
// not permitted"). Invoke an absolute node binary directly against tsx + the
// source entry instead — this keeps __dirname at the project root (so .env and
// schemas/ resolve correctly) and avoids both the PATH and script-exec issues.
mcpServers["healthie-dev-assist"] = {
  command: process.execPath,
  args: [tsxCliPath, serverEntryPath],
};

// Clean up orphaned "healthie" entry (left behind by early v2 setup)
if ("healthie" in mcpServers) {
  delete mcpServers["healthie"];
  console.log('Removed orphaned "healthie" config entry.');
}

// ── Write back ────────────────────────────────────────────────────────────────

const configDir = dirname(configPath);
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

writeFileSync(configPath, JSON.stringify(config, null, 2));

if (existing) {
  console.log("Updated healthie-dev-assist entry in Claude Desktop config.");
} else {
  console.log("Added healthie-dev-assist entry to Claude Desktop config.");
}
console.log(`Config: ${configPath}`);

// ── Auto-install dependencies if needed ──────────────────────────────────────

const tsxBin = resolve(projectRoot, "node_modules", ".bin", "tsx");
if (!existsSync(tsxBin)) {
  console.log("\nInstalling dependencies...");
  execSync("npm install", { cwd: projectRoot, stdio: "inherit" });
}

// ── Auto-regenerate schema if needed ─────────────────────────────────────────

const schemaPath = resolve(projectRoot, "schemas", "staging.graphql");
if (!existsSync(schemaPath)) {
  console.log("\nDownloading GraphQL schema...");
  execSync("npm run regenerate-schema", { cwd: projectRoot, stdio: "inherit" });
}

// ── Clean up old schema artifacts ────────────────────────────────────────────

const oldSchemaFiles = [
  resolve(projectRoot, "schemas", "healthie-schema.graphql"),
  resolve(projectRoot, "schemas", "introspection-result.json"),
];

for (const file of oldSchemaFiles) {
  if (existsSync(file)) {
    unlinkSync(file);
    console.log(`Removed old schema artifact: ${file}`);
  }
}

// ── Final message ────────────────────────────────────────────────────────────

if (!existsSync(resolve(projectRoot, ".env"))) {
  console.log(
    "\nNext: copy .env.example to .env and add your HEALTHIE_API_KEY"
  );
} else {
  console.log("\nRestart Claude Desktop to apply changes.");
}
