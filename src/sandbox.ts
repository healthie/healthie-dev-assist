import vm from "vm";
import { createHealthieApi } from "./api.js";

const TIMEOUT_MS = 30_000;

export interface SandboxResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute LLM-written code in a vm context.
 *
 * The sandbox has access to:
 * - `healthie` — the Healthie API object (search, introspect, schema, query, mutate)
 * - `console` — for debugging output (captured)
 * - `Promise`, `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Error`, etc.
 *
 * Note: Node.js vm is NOT a security boundary. The healthie.query/mutate methods
 * make real HTTP requests. The sandbox limits the API surface for LLM convenience,
 * not for security isolation.
 */
export async function executeInSandbox(code: string): Promise<SandboxResult> {
  const logs: string[] = [];
  const controller = new AbortController();

  const sandbox = {
    healthie: createHealthieApi(controller.signal),
    console: {
      log: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
      error: (...args: unknown[]) =>
        logs.push("[error] " + args.map(stringify).join(" ")),
      warn: (...args: unknown[]) =>
        logs.push("[warn] " + args.map(stringify).join(" ")),
      info: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
    },
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    undefined,
    null: null,
    true: true,
    false: false,
  };

  vm.createContext(sandbox);

  // Wrap code in an async IIFE so the LLM can use top-level await and return
  const wrapped = `
(async () => {
  ${code}
})()
`.trim();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const script = new vm.Script(wrapped, {
      filename: "execute_healthie_code",
      lineOffset: -1,
    });

    const resultPromise = script.runInContext(sandbox, {
      timeout: TIMEOUT_MS,
      breakOnSigint: true,
    }) as Promise<unknown>;

    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error("Execution timed out after 30s"));
        }, TIMEOUT_MS);
      }),
    ]);

    return {
      success: true,
      result: logs.length > 0 ? { output: result, logs } : result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: logs.length > 0 ? `${message}\n\nConsole output:\n${logs.join("\n")}` : message,
    };
  } finally {
    clearTimeout(timeoutHandle);
    controller.abort();
  }
}

function stringify(val: unknown): string {
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}
