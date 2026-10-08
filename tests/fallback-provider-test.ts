/**
 * FallbackProvider suite — Phase B.10.0. Verifies the sequential
 * Groq→OpenRouter emergency fallback: eligibility, single-use, retry
 * layering, ordering, metadata and secret hygiene. Stub HTTP servers
 * only — no real Groq/OpenRouter calls, no real keys.
 */
import { createServer, Server } from "node:http";
import { FallbackProvider } from "../src/agents/providers/fallback-provider.js";
import { GroqProvider } from "../src/agents/providers/groq-provider.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { OpenRouterProvider } from "../src/agents/providers/openrouter-provider.js";
import { ProviderError } from "../src/agents/providers/omniroute-provider.js";
import { createAIProvider } from "../src/agents/providers/provider-factory.js";
import { AIRequest } from "../src/agents/contracts/ai-provider.js";

let passed = 0;
let failed = 0;

function t(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

type Handler = (
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
  callCount: number
) => {
  status: number;
  json?: unknown;
  delayMs?: number;
  raw?: string;
};

const order: string[] = [];

function stubServer(
  label: string,
  handler: Handler
): Promise<{ server: Server; url: string; calls: () => number }> {
  let count = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", async () => {
      count++;
      order.push(label);
      const out = handler(JSON.parse(raw || "{}"), req.headers, count);
      if (out.delayMs) await new Promise(r => setTimeout(r, out.delayMs));
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(out.raw ?? JSON.stringify(out.json ?? {}));
    });
  });
  return new Promise(r =>
    server.listen(0, () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      r({ server, url: `http://127.0.0.1:${port}`, calls: () => count });
    })
  );
}

const baseReq: AIRequest = {
  messages: [
    { role: "system", content: "You are a strategist." },
    { role: "user", content: "Build an app." }
  ]
};

const okGroq = {
  choices: [{ message: { content: "{\"from\":\"groq\"}" } }],
  model: "openai/gpt-oss-120b"
};
const okOr = {
  choices: [{ message: { content: "{\"from\":\"openrouter\"}" } }],
  model: "openai/gpt-oss-120b"
};

const mkGroq = (url: string, timeoutMs = 2000, apiKey?: string) =>
  new GroqProvider({
    baseUrl: url, apiKey: apiKey ?? "gsk_test", model: "m", timeoutMs
  });
const mkOr = (url: string, timeoutMs = 2000) =>
  new OpenRouterProvider({
    baseUrl: url, apiKey: "sk-or-test", model: "openai/gpt-oss-120b", timeoutMs
  });

async function run(
  groqHandler: Handler,
  orHandler: Handler = () => ({ status: 200, json: okOr }),
  groqTimeout = 2000,
  orTimeout = 2000,
  groqKey?: string
) {
  const g = await stubServer("groq", groqHandler);
  const o = await stubServer("openrouter", orHandler);
  const p = new FallbackProvider(
    mkGroq(g.url, groqTimeout, groqKey),
    mkOr(o.url, orTimeout)
  );
  const res = await p.generate(baseReq).catch(e => e);
  g.server.close();
  o.server.close();
  return { res, groqCalls: g.calls(), orCalls: o.calls() };
}

// A: Groq success → OpenRouter never called
{
  const { res, orCalls } = await run(() => ({ status: 200, json: okGroq }));
  t("A: groq success → OR not called",
    !(res instanceof Error) && res.content === "{\"from\":\"groq\"}" &&
    orCalls === 0);
  t("A/R: metadata marks primary groq, fallbackUsed=false",
    !(res instanceof Error) &&
    res.metadata?.primaryProvider === "groq" &&
    res.metadata?.fallbackUsed === false &&
    res.metadata?.simulated === false);
}

// B: Groq 429 exhausted → fallback once
{
  const { res, groqCalls, orCalls } = await run(() => ({ status: 429 }));
  t("B: 429 exhausted → OR called exactly once",
    !(res instanceof Error) && groqCalls === 2 && orCalls === 1);
}

// C: Groq 503 exhausted → fallback
{
  const { res, groqCalls, orCalls } = await run(() => ({ status: 503 }));
  t("C: 5xx exhausted → OR called",
    !(res instanceof Error) && groqCalls === 2 && orCalls === 1);
}

// D: Groq timeout exhausted → fallback
{
  const { res, groqCalls, orCalls } = await run(
    () => ({ status: 200, json: okGroq, delayMs: 300 }),
    () => ({ status: 200, json: okOr }),
    50
  );
  t("D: timeout exhausted → OR called",
    !(res instanceof Error) && groqCalls === 2 && orCalls === 1);
}

// E: Groq network error → fallback
{
  const g = await stubServer("groq", () => ({ status: 200, json: okGroq }));
  const o = await stubServer("openrouter", () => ({ status: 200, json: okOr }));
  g.server.close(); // unreachable
  const p = new FallbackProvider(mkGroq(g.url), mkOr(o.url));
  const res = await p.generate(baseReq).catch(e => e);
  o.server.close();
  t("E: network_error exhausted → OR called",
    !(res instanceof Error) && o.calls() === 1);
}

// F–K: non-eligible errors never reach OpenRouter
for (const [name, handler, wantCode, wantGroqCalls] of [
  ["F: 400", () => ({ status: 400 }), "bad_request", 1],
  ["G: 401", () => ({ status: 401 }), "unauthorized", 1],
  ["H/I: 404", () => ({ status: 404 }), "provider_not_found", 1],
  ["J: non-JSON", () => ({ status: 200, raw: "<html>" }), "invalid_response", 1]
] as const) {
  const { res, groqCalls, orCalls } = await run(handler as Handler);
  t(`${name} → OR NOT called, original error propagates`,
    res instanceof ProviderError && res.code === wantCode &&
    orCalls === 0 && groqCalls === wantGroqCalls);
}
{
  // K: not_configured (no apiKey) → no fallback
  const { res, orCalls } = await run(
    () => ({ status: 200, json: okGroq }),
    () => ({ status: 200, json: okOr }),
    2000, 2000, ""
  );
  t("K: not_configured → OR NOT called",
    res instanceof ProviderError && res.code === "not_configured" &&
    orCalls === 0);
}
{
  // non-ProviderError (engine/programming) → no fallback
  const boom = { generate: () => Promise.reject(new TypeError("bug")) };
  const p = new FallbackProvider(
    { id: "groq", name: "Groq", supports: () => true, generate: boom.generate } as never,
    mkOr("http://127.0.0.1:1")
  );
  const res = await p.generate(baseReq).catch(e => e);
  t("non-ProviderError → propagates, no fallback",
    res instanceof TypeError);
}

// L: fallback disabled → factory returns bare provider
{
  const p = createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "k" });
  t("L: no AI_FALLBACK_PROVIDER → bare GroqProvider",
    p instanceof GroqProvider && !(p instanceof FallbackProvider));
}

// M/O/R: fallback success semantics + metadata
{
  const { res } = await run(() => ({ status: 503 }));
  t("M: fallback success returns OpenRouter response",
    !(res instanceof Error) && res.content === "{\"from\":\"openrouter\"}" &&
    res.provider === "openrouter");
  t("O/R: metadata fallbackUsed=true, primaryError recorded",
    !(res instanceof Error) &&
    res.metadata?.fallbackUsed === true &&
    res.metadata?.primaryProvider === "groq" &&
    res.metadata?.primaryError === "provider_unavailable");
  t("R: no secrets in response/metadata",
    !(res instanceof Error) &&
    !JSON.stringify(res).includes("sk-or-test") &&
    !JSON.stringify(res).includes("gsk_test"));
}

// N: OpenRouter failure propagates its own error
{
  const { res } = await run(
    () => ({ status: 503 }),
    () => ({ status: 429, resHeaders: {} } as never)
  );
  t("N: OR failure → its ProviderError propagates",
    res instanceof ProviderError && res.code === "rate_limited");
}

// P/Q: strictly sequential, bounded — groq calls happen before OR
{
  order.length = 0;
  await run(() => ({ status: 503 }));
  const g1 = order.indexOf("groq");
  const g2 = order.indexOf("groq", g1 + 1);
  const o1 = order.indexOf("openrouter");
  t("P: strictly sequential (groq,groq → openrouter)",
    order.length === 3 && g1 === 0 && g2 === 1 && o1 === 2);
  t("Q: bounded — no loop (2 groq + 1 OR max)",
    order.length === 3);
}

// S: fallback timeout is independent of primary timeout
{
  const { res, orCalls } = await run(
    () => ({ status: 200, json: okGroq, delayMs: 300 }),
    () => ({ status: 200, json: okOr, delayMs: 300 }),
    50,   // groq times out at 50ms
    2000  // OR fallback tolerates 300ms delay
  );
  t("S: fallback uses own timeout (OR 300ms OK under 2s)",
    !(res instanceof Error) && orCalls === 1);
}

// factory wiring: FallbackProvider wraps groq with OpenRouter
{
  const p = createAIProvider({
    AI_PROVIDER: "groq",
    GROQ_API_KEY: "k",
    AI_FALLBACK_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "k2",
    OPENROUTER_FALLBACK_MODEL: "openai/gpt-oss-120b",
    OPENROUTER_FALLBACK_TIMEOUT_MS: "120000"
  });
  t("factory: groq+fallback → FallbackProvider",
    p instanceof FallbackProvider && p.id === "groq");
  t("factory: primary=groq, fallback=openrouter",
    p instanceof FallbackProvider &&
    p.primary.id === "groq" && p.fallback.id === "openrouter");
}
{
  const p = createAIProvider({ AI_PROVIDER: "mock", AI_FALLBACK_PROVIDER: "openrouter" });
  t("factory: mock never gets a fallback wrapper",
    p instanceof MockAIProvider && !(p instanceof FallbackProvider));
}
{
  const p = createAIProvider({
    AI_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "k",
    AI_FALLBACK_PROVIDER: "openrouter"
  });
  t("factory: openrouter primary → no self-fallback",
    p instanceof OpenRouterProvider && !(p instanceof FallbackProvider));
}
{
  const p = createAIProvider({
    AI_PROVIDER: "groq", GROQ_API_KEY: "k", AI_FALLBACK_PROVIDER: "bogus"
  });
  t("factory: unknown fallback → ignored (bare groq)",
    p instanceof GroqProvider && !(p instanceof FallbackProvider));
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
