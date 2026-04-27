<div align="center">

<img src="images/healthie-logo.png" alt="Healthie" width="140" /><br /><br />

# Healthie Dev Assist

**MCP server for AI-powered Healthie API exploration**

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-6366f1?style=flat-square)](https://modelcontextprotocol.io)

*From 5–10 tool calls to 1–2. Schema-aware. Sandboxed. Instant.*

</div>

---

![Healthie Dev Assist demo](images/devassist-smooth.gif)

---

## Overview

Classic MCP servers expose one operation per tool call — search a type, wait, introspect it, wait, build a query, wait. **Dev Assist 2.0** changes this with a **code execution model**: your AI writes a small TypeScript program that performs all steps in a single turn.

| | v1 | v2 |
|---|:---:|:---:|
| Turns per typical task | 5–10 | **1–2** |
| Schema exploration | One call at a time | Search + introspect + query in one shot |
| Tools exposed | Many | **One** (`execute_healthie_code`) |
| Schema lookups | Live API each turn | Cached locally — instant |

**Example**: "Find all appointment mutations and show me what `createAppointment` takes" — previously 3+ tool calls. In 2.0:

```typescript
const mutations = await healthie.search("appointment", { kind: "mutation" });
const details = await healthie.introspect("createAppointmentInput");
return { mutations, details };
```

Done in one execution.

---

## API

Your AI has access to a single `healthie` object inside a sandboxed Node.js environment (no filesystem, network, or shell access — only these methods):

```typescript
// Search the schema by keyword
healthie.search(query: string, options?: { kind: "query" | "mutation" | "type" }) → SearchResult[]

// Get full details on any type, query, or mutation
healthie.introspect(typeName: string, options?: { depth: number }) → TypeDetails

// Execute a GraphQL query
healthie.query(graphql: string, variables?: Record<string, unknown>) → any

// Execute a GraphQL mutation
healthie.mutate(graphql: string, variables?: Record<string, unknown>) → any
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/healthie/healthie-dev-assist.git
cd healthie-dev-assist
npm install
```

### 2. Configure your API key

```bash
cp .env.example .env
```

Edit `.env`:
```
HEALTHIE_API_KEY=your-api-key-here
```

> Schema search and introspection work without a key. `query` and `mutate` require one.

**Shard environments:** If your data is hosted in a Healthie shard environment, also set:
```
HEALTHIE_AUTHORIZATION_SHARD=your-shard-id
```

### 3. Download the schema

```bash
npm run regenerate-schema
```

Fetches Healthie's GraphQL schema and caches it locally. Re-run after API updates.

### 4. Connect your AI tool

<details>
<summary><strong>Claude Desktop</strong></summary>

```bash
npm run setup
```

Restart Claude Desktop after this runs.

</details>

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

```bash
claude mcp add healthie -- npx tsx /path/to/healthie-dev-assist/src/server.ts
```

Verify with `claude mcp list`.

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to Cursor's MCP settings:

```json
{
  "mcp": {
    "servers": {
      "healthie-dev-assist": {
        "command": "npx",
        "args": ["tsx", "/path/to/healthie-dev-assist/src/server.ts"]
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Built version (faster startup)</strong></summary>

```bash
npm run build
```

Then use `node /path/to/healthie-dev-assist/dist/server.js` in place of `npx tsx ...` in any config above.

</details>

---

## Upgrading from v1 (macOS)

Run this single command in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/healthie/healthie-dev-assist/main/upgrade.sh | bash
```

This will automatically:
- Find your existing installation
- Download the latest version
- Preserve your API key
- Update your Claude Desktop configuration

Restart Claude Desktop after it completes.

> **Other platforms:** Pull the latest code manually, then run `npm run setup` from the project directory.

---

## Usage

Once connected, ask your AI naturally:

- *"Find all patient-related queries and show me what fields are available"*
- *"What arguments does `createAppointment` take?"*
- *"Fetch the last 5 appointments for patient ID 123"*
- *"Show me all mutations related to billing"*

The AI handles schema exploration and API calls in one or two turns.

---

## Multi-Instance Support

To run separate staging instances (e.g. different API keys):

```bash
cp environments.example.json environments.json
```

Edit `environments.json`:

```json
{
  "staging": {
    "apiUrl": "https://staging-api.gethealthie.com/graphql",
    "apiKey": "your-staging-key",
    "authorizationShard": "optional-shard-id"
  }
}
```

Add one MCP server entry per environment, passing `HEALTHIE_ENV`:

```json
{
  "mcpServers": {
    "healthie-staging": {
      "command": "npx",
      "args": ["tsx", "/path/to/healthie-dev-assist/src/server.ts"],
      "env": { "HEALTHIE_ENV": "staging" }
    }
  }
}
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Schema not found` | Run `npm run regenerate-schema`. Verify your API key is set in `.env`. |
| `HEALTHIE_API_KEY required` | Add your key to `.env` or `environments.json`. |
| Tool not appearing in Claude | Use absolute paths (not `~/` or relative) in MCP config. Restart your AI tool. |
| `Module not found` | Run `npm install` from the project directory. |

---

## ⚠️ Security

> **Use staging only.** Do not connect this tool to a production Healthie environment. Most AI platforms do not have a Business Associate Agreement (BAA) in place, and production data contains PHI.

---

## Support

- [GitHub Issues](https://github.com/healthie/healthie-dev-assist/issues)
- [Healthie API Docs](https://docs.gethealthie.com/guides/intro/)

---

<div align="center">
<sub>MIT License</sub>
</div>
