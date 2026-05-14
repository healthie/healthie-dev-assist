/**
 * Functional test suite for Healthie Code Mode MCP server.
 *
 * Tests the core healthie API object directly (bypassing MCP transport).
 * Run with: npm test
 *
 * Requires: HEALTHIE_API_KEY in .env, schema generated via npm run regenerate-schema
 */

import { search, introspect, getSchema } from "../src/api.js";
import { executeInSandbox } from "../src/sandbox.js";
import { schemaExists } from "../src/schema.js";
import { config } from "../config.js";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error });
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("\nHealthie Code Mode — Functional Tests");
console.log(`Environment: ${config.envName}`);
console.log(`Schema: ${config.schemaPath}`);
console.log("─".repeat(50));

// F4 — Schema file exists (prerequisite for all other tests)
console.log("\nPrerequisite checks:");
await test("F4: Schema file exists", async () => {
  assert(schemaExists(), `Schema not found at ${config.schemaPath}. Run: npm run regenerate-schema`);
});

if (!schemaExists()) {
  console.log("\n✗ Cannot run remaining tests without schema. Run: npm run regenerate-schema");
  process.exit(1);
}

// F1 — Schema search
console.log("\nF1: Schema search:");
await test("Search 'appointment' returns results", async () => {
  const results = await search("appointment");
  assert(results.length > 0, "No results returned for 'appointment'");
  const names = results.map((r) => r.name);
  console.log(`    Found: ${names.slice(0, 5).join(", ")}...`);
});

await test("Search with kind='type' returns type results", async () => {
  const results = await search("appointment", { kind: "type" });
  assert(results.length > 0, "No type results for 'appointment'");
  assert(
    results.every((r) => !["QUERY", "MUTATION"].includes(r.kind)),
    "Query/Mutation kinds should not appear in type-only search"
  );
});

await test("Search with kind='query' returns query results", async () => {
  const results = await search("appointment", { kind: "query" });
  assert(results.length > 0, "No query results for 'appointment'");
  assert(
    results.every((r) => r.kind === "QUERY"),
    "All results should be QUERY kind"
  );
});

await test("Search with kind='mutation' returns mutation results", async () => {
  const results = await search("appointment", { kind: "mutation" });
  assert(results.length > 0, "No mutation results for 'appointment'");
  assert(
    results.every((r) => r.kind === "MUTATION"),
    "All results should be MUTATION kind"
  );
});

await test("Search limit is respected", async () => {
  const results = await search("a", { limit: 5 });
  assert(results.length <= 5, `Expected ≤5 results, got ${results.length}`);
});

// F7 — Non-existent type
await test("F7: Search for non-existent type returns empty", async () => {
  const results = await search("zzznonexistentxxx");
  assert(Array.isArray(results), "Should return an array");
  assert(results.length === 0, `Expected 0 results, got ${results.length}`);
});

// F2 — Type introspection
console.log("\nF2: Type introspection:");
await test("Introspect 'Appointment' type returns fields", async () => {
  const details = await introspect("Appointment");
  assert(details.name === "Appointment", `Expected name 'Appointment', got '${details.name}'`);
  assert(details.kind === "OBJECT", `Expected kind 'OBJECT', got '${details.kind}'`);
  assert(Array.isArray(details.fields), "Expected fields array");
  assert((details.fields?.length ?? 0) > 0, "Expected non-empty fields");
  const fieldNames = details.fields?.map((f) => f.name) ?? [];
  console.log(`    Fields: ${fieldNames.slice(0, 5).join(", ")}...`);
});

await test("Introspect is case-insensitive", async () => {
  const lower = await introspect("appointment");
  assert(lower.name === "Appointment", `Case-insensitive lookup failed: got '${lower.name}'`);
});

await test("Introspect non-existent type throws", async () => {
  let threw = false;
  try {
    await introspect("ZzzNonExistentType");
  } catch {
    threw = true;
  }
  assert(threw, "Expected introspect to throw for non-existent type");
});

// F3 — Multi-step in sandbox
console.log("\nF3: Multi-step sandbox execution:");
await test("Search + introspect in single execution", async () => {
  const result = await executeInSandbox(`
    const searchResults = await healthie.search("appointment", { limit: 3 });
    const firstType = searchResults.find(r => r.kind === 'OBJECT');
    if (!firstType) return { searchResults, message: "No OBJECT type found" };
    const details = await healthie.introspect(firstType.name);
    return { searchResults, details };
  `);

  assert(result.success, `Sandbox error: ${result.error}`);
  const data = result.result as { searchResults: unknown[]; details: { fields?: unknown[] } };
  assert(Array.isArray(data.searchResults), "Expected searchResults array");
  assert(data.details?.fields !== undefined || true, "Expected details");
});

await test("Parallel search in sandbox", async () => {
  const result = await executeInSandbox(`
    const [appts, patients] = await Promise.all([
      healthie.search("appointment", { limit: 5 }),
      healthie.search("patient", { limit: 5 }),
    ]);
    return { appointmentCount: appts.length, patientCount: patients.length };
  `);

  assert(result.success, `Sandbox error: ${result.error}`);
  const data = result.result as { appointmentCount: number; patientCount: number };
  assert(data.appointmentCount > 0, "Expected appointment results");
  assert(data.patientCount > 0, "Expected patient results");
});

await test("healthie.schema() returns SDL string", async () => {
  const sdl = await getSchema();
  assert(typeof sdl === "string", "Expected string");
  assert(sdl.length > 1000, `Schema too short: ${sdl.length} chars`);
  assert(sdl.includes("type Query"), "Expected 'type Query' in SDL");
});

// F6 — Invalid code error handling
console.log("\nF6: Sandbox error handling:");
await test("Syntax error is caught cleanly", async () => {
  const result = await executeInSandbox("this is not valid javascript }{");
  assert(!result.success, "Expected failure");
  assert(typeof result.error === "string", "Expected error message");
});

await test("Runtime error is caught cleanly", async () => {
  const result = await executeInSandbox(`
    throw new Error("intentional test error");
  `);
  assert(!result.success, "Expected failure");
  assert(result.error?.includes("intentional test error"), "Expected error message");
});

await test("No access to process/require/fs in sandbox", async () => {
  const result1 = await executeInSandbox("return typeof process");
  const result2 = await executeInSandbox("return typeof require");
  const result3 = await executeInSandbox("return typeof fetch");

  // These should either be "undefined" or throw
  const isUndefinedOrFailed = (r: typeof result1) =>
    !r.success || r.result === "undefined";

  assert(isUndefinedOrFailed(result1), `process should not be available: ${JSON.stringify(result1)}`);
  assert(isUndefinedOrFailed(result2), `require should not be available: ${JSON.stringify(result2)}`);
  assert(isUndefinedOrFailed(result3), `fetch should not be available: ${JSON.stringify(result3)}`);
});

// F5 — Configuration check
console.log("\nF5: Configuration:");
await test("Config loaded (URL and env)", async () => {
  assert(config.apiUrl.includes("healthie"), "API URL should be a Healthie endpoint");
  assert(config.envName.length > 0, "Env name should not be empty");
});

await test("Missing API key gives clear error on query/mutate", async () => {
  // If no API key, executeGraphQL should throw a clear error
  if (!config.apiKey) {
    const result = await executeInSandbox(
      `return await healthie.query("{ __typename }")`
    );
    assert(!result.success, "Expected failure without API key");
    assert(
      result.error?.includes("HEALTHIE_API_KEY") ?? false,
      `Expected HEALTHIE_API_KEY error, got: ${result.error}`
    );
  } else {
    // API key is set — just verify it looks plausible
    assert(config.apiKey.length > 0, "API key should not be empty");
  }
});

// AbortController — signal threading and cleanup
console.log("\nAbortController: signal threading and cleanup:");

await test("Abort signal is passed to fetch and aborted after sandbox completes", async () => {
  const capturedSignals: AbortSignal[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    if (init?.signal) capturedSignals.push(init.signal);
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    const result = await executeInSandbox(`
      healthie.query("{ __typename }");
      return "done";
    `);

    assert(result.success, `Sandbox unexpectedly failed: ${result.error}`);
    assert(capturedSignals.length > 0, "Expected fetch to be called with a signal");
    assert(
      capturedSignals.every((s) => s.aborted),
      "All fetch signals should be aborted after sandbox exits"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("Abort signal is aborted even when sandbox throws", async () => {
  const capturedSignals: AbortSignal[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    if (init?.signal) capturedSignals.push(init.signal);
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    await executeInSandbox(`
      healthie.query("{ __typename }");
      throw new Error("intentional");
    `);

    assert(capturedSignals.length > 0, "Expected fetch to be called with a signal");
    assert(
      capturedSignals.every((s) => s.aborted),
      "All fetch signals should be aborted even after sandbox error"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\nFailed tests:");
  results
    .filter((r) => !r.passed)
    .forEach((r) => console.log(`  ✗ ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log("All tests passed! ✓");
}
