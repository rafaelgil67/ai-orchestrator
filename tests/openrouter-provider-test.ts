/**
 * OpenRouter provider suite — Phase B.9. Verifies factory selection,
 * direct OpenAI-compatible wire format (json_schema + strict), auth,
 * error normalization, B.8.7 retry policy inheritance and secret
 * hygiene for the OpenRouter path. Uses a local stub HTTP server —
 * no real OpenRouter call and no real key needed.
 */
import { createServer, Server } from "node:http";
import {
  OpenRouterProvider,
  OPENROUTER_API_BASE_URL,
  OPENROUTER_DEFAULT_MODEL
} from "../src/agents/providers/openrouter-provider.js";
import {
  OmniRouteProvider,
  ProviderError
} from "../src/agents/providers/omniroute-provider.js";
import { GroqProvider } from "../src/agents/providers/groq-provider.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { createAIProvider } from "../src/agents/providers/provider-factory.js";
import { AIRequest, AIResponse } from "../src/agents/contracts/ai-provider.js";
import { PROJECT_BLUEPRINT_JSON_SCHEMA } from "../src/core/strategy/contracts.js";

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
  resHeaders?: Record<string, string>;
  /** Send headers (+ optional partial body) then hold the body open —
   *  simulates upstream keep-alive padding during slow generation. */
  stallMs?: number;
  partialBody?: string;
};

function stubServer(handler: Handler): Promise<{
  server: Server;
  url: string;
  calls: () => number;
}> {
  let count = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", async () => {
      count++;
      const out = handler(JSON.parse(raw || "{}"), req.headers, count);
      if (out.delayMs) await new Promise(r => setTimeout(r, out.delayMs));
      res.writeHead(out.status, {
        "Content-Type": "application/json",
        ...out.resHeaders
      });
      if (out.stallMs !== undefined) {
        if (out.partialBody) res.write(out.partialBody);
        setTimeout(() => {
          try { res.end(); } catch { /* client already aborted */ }
        }, out.stallMs);
        return;
      }
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

const schemaReq: AIRequest = {
  ...baseReq,
  responseFormat: "json",
  responseSchema: {
    name: "ProjectBlueprint",
    schema: PROJECT_BLUEPRINT_JSON_SCHEMA
  }
};

const okBody = {
  choices: [{ message: { content: "{\"ok\":true}" } }],
  model: "openrouter/free",
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
};

const mkOR = (url: string, timeoutMs = 2000) =>
  new OpenRouterProvider({
    baseUrl: url, apiKey: "sk-or-test", model: "openrouter/free", timeoutMs
  });

const expectProviderError = async (
  code: string,
  op: () => Promise<unknown>
): Promise<boolean> => {
  try {
    await op();
    return false;
  } catch (e) {
    return e instanceof ProviderError && e.code === code;
  }
};

// A — factory selection
{
  t("A: openrouter + key → OpenRouterProvider",
    createAIProvider({
      AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-t"
    }) instanceof OpenRouterProvider);
  t("A: openrouter provider id is 'openrouter'",
    createAIProvider({
      AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-t"
    }).id === "openrouter");
  const unconfigured = createAIProvider({ AI_PROVIDER: "openrouter" });
  t("A: openrouter sin key → NO mock (provider explícito)",
    unconfigured instanceof OpenRouterProvider &&
      unconfigured.id === "openrouter");
  t("A: openrouter sin key → generate() lanza not_configured",
    await expectProviderError("not_configured", () =>
      unconfigured.generate(baseReq)));
  t("A: mensaje not_configured identifica OpenRouter",
    await unconfigured.generate(baseReq).catch((e: Error) =>
      e.message.includes("openrouter") || e.message.includes("OPENROUTER")));
  t("A: groq/omniroute/mock intactos en factory",
    createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "k" })
      instanceof GroqProvider &&
    createAIProvider({
      AI_PROVIDER: "omniroute", OMNIROUTE_URL: "http://x"
    }) instanceof OmniRouteProvider &&
    createAIProvider({}).id === "mock" &&
    createAIProvider({ AI_PROVIDER: "nonsense" }).id === "mock");
}

// B — wire format
{
  let seen: Record<string, unknown> = {};
  let seenAuth: unknown;
  const { server, url } = await stubServer((body, headers) => {
    seen = body;
    seenAuth = headers.authorization;
    return { status: 200, json: okBody };
  });
  const res = await mkOR(url).generate(schemaReq);
  server.close();

  const rf = seen.response_format as {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  t("B: response_format.type === json_schema", rf?.type === "json_schema");
  t("B: json_schema.name === ProjectBlueprint",
    rf?.json_schema?.name === "ProjectBlueprint");
  t("B: json_schema.strict === true", rf?.json_schema?.strict === true);
  t("B: schema verbatim",
    JSON.stringify(rf?.json_schema?.schema) ===
      JSON.stringify(PROJECT_BLUEPRINT_JSON_SCHEMA));
  t("B: model === openrouter/free", seen.model === "openrouter/free");
  t("B: Authorization Bearer", seenAuth === "Bearer sk-or-test");
  t("B: response real (provider=openrouter, simulated=false)",
    res.provider === "openrouter" &&
      res.metadata?.simulated === false &&
      res.metadata?.attempt === 1);
}

// C — defaults + legacy
{
  t("C: default baseUrl openrouter.ai/api",
    OPENROUTER_API_BASE_URL === "https://openrouter.ai/api");
  t("C: default model openrouter/free",
    OPENROUTER_DEFAULT_MODEL === "openrouter/free");

  let seen: Record<string, unknown> = {};
  const { server, url } = await stubServer(body => {
    seen = body;
    return { status: 200, json: okBody };
  });
  await mkOR(url).generate({ ...baseReq, responseFormat: "json" });
  server.close();
  t("C: sin schema → json_object legacy",
    JSON.stringify(seen.response_format) ===
      JSON.stringify({ type: "json_object" }));
}

// D — error normalization + labels
{
  const check = async (status: number, code: string) => {
    const { server, url } = await stubServer(() => ({ status }));
    const e = await mkOR(url).generate(baseReq).catch(err => err);
    server.close();
    return e instanceof ProviderError && e.code === code &&
      e.message.includes("OpenRouter") && !e.message.includes("OmniRoute") &&
      !e.message.includes("Groq");
  };
  t("D: 401/403 → unauthorized 'OpenRouter'",
    await check(401, "unauthorized") && await check(403, "unauthorized"));
  t("D: 404 → provider_not_found 'OpenRouter'",
    await check(404, "provider_not_found"));
  t("D: 400 sin schema → bad_request 'OpenRouter'",
    await check(400, "bad_request"));

  // timeout + network labels
  const { server, url } = await stubServer(() => ({
    status: 200, json: okBody, delayMs: 300
  }));
  const te = await mkOR(url, 50).generate(baseReq)
    .then(() => null).catch((e: ProviderError) => e);
  server.close();
  // may take 2 attempts (timeout retried) — final error is timeout
  t("D: timeout → 'OpenRouter' label",
    te?.code === "timeout" && te.message.includes("OpenRouter"));

  const { server: s2, url: u2 } = await stubServer(() => ({
    status: 200, json: okBody
  }));
  s2.close();
  const ne = await mkOR(u2).generate(baseReq)
    .then(() => null).catch((e: ProviderError) => e);
  t("D: network_error → 'OpenRouter provider' label",
    ne?.code === "network_error" &&
      ne.message.includes("OpenRouter provider"));
}

// E — retry policy inherited (B.8.7)
{
  const { server, url, calls } = await stubServer((_b, _h, n) =>
    n === 1 ? { status: 503 } : { status: 200, json: okBody });
  const r = await mkOR(url).generate(baseReq);
  server.close();
  t("E: 503 → retry → 200, attempt=2",
    r.content === "{\"ok\":true}" && calls() === 2 &&
      r.metadata?.attempt === 2);
}
{
  const { server, url, calls } = await stubServer(() => ({ status: 503 }));
  const ok = await expectProviderError("provider_unavailable",
    () => mkOR(url).generate(baseReq));
  server.close();
  t("E: 503 agotado → 2 requests", ok && calls() === 2);
}
{
  const { server, url, calls } = await stubServer((_b, _h, n) =>
    n === 1 ? { status: 400 } : { status: 200, json: okBody });
  const r = await mkOR(url).generate(schemaReq);
  server.close();
  t("E: 400+schema → retry → 200", calls() === 2 &&
    r.content === "{\"ok\":true}");
}
{
  const { server, url, calls } = await stubServer(() => ({ status: 401 }));
  const ok = await expectProviderError("unauthorized",
    () => mkOR(url).generate(baseReq));
  server.close();
  t("E: 401 → NO retry, 1 request", ok && calls() === 1);
}
{
  const { server, url, calls } = await stubServer(() =>
    ({ status: 200, raw: "<<not json>>" }));
  const ok = await expectProviderError("invalid_response",
    () => mkOR(url).generate(baseReq));
  server.close();
  t("E: non-JSON → invalid_response, 1 request", ok && calls() === 1);
}

// F — secret hygiene
{
  const secret = "sk-or-super_secret_value";
  const { server, url } = await stubServer(() => ({ status: 429 }));
  const p = new OpenRouterProvider({
    baseUrl: url, apiKey: secret, model: "m", timeoutMs: 2000
  });
  const e = await p.generate(baseReq).catch(err => err);
  server.close();
  const blob = String(e) + String((e as Error)?.stack ?? "");
  t("F: OPENROUTER_API_KEY ausente de error+stack", !blob.includes(secret));
}

// B.9.7 — OpenRouter inherits the body-read timeout fix: headers (200)
// + stalled body must classify as "timeout" and be retried, not
// "invalid_response" (the real failure observed in B.9.6 smoke).
{
  const { server, url, calls } = await stubServer((_b, _h, n) =>
    n === 1
      ? { status: 200, stallMs: 60_000, partialBody: "   " }
      : { status: 200, json: okBody });
  const res = await mkOR(url, 50).generate(baseReq);
  server.close();
  t("B97: body-read timeout → retry → 200 (inherited fix)",
    res.content === "{\"ok\":true}" && calls() === 2 &&
    res.metadata?.attempt === 2);
}
{
  const { server, url, calls } = await stubServer(() => ({
    status: 200, stallMs: 60_000, partialBody: "   "
  }));
  const e = await mkOR(url, 50).generate(baseReq).catch(err => err);
  server.close();
  t("B97: stalled body exhaustion → timeout (not invalid_response)",
    e instanceof ProviderError && e.code === "timeout" && calls() === 2);
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
