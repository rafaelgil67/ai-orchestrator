/**
 * OmniRoute provider suite — Phase B. Verifies request/response
 * mapping, timeout, error normalization, secret hygiene and the
 * REAL-vs-SIMULATED distinction. Uses a local stub HTTP server — no
 * real OmniRoute needed.
 */
import { createServer, Server } from "node:http";
import { OmniRouteProvider, ProviderError } from "../src/agents/providers/omniroute-provider.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
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
  headers: Record<string, string | string[] | undefined>
) => { status: number; json?: unknown; delayMs?: number };

function stubServer(handler: Handler): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", async () => {
      const out = handler(JSON.parse(raw || "{}"), req.headers);
      if (out.delayMs) await new Promise(r => setTimeout(r, out.delayMs));
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  return new Promise(r =>
    server.listen(0, () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      r({ server, url: `http://127.0.0.1:${port}` });
    })
  );
}

const baseReq: AIRequest = {
  messages: [
    { role: "system", content: "You are a strategist." },
    { role: "user", content: "Build an app." }
  ],
  temperature: 0.2,
  maxTokens: 500
};

const okBody = {
  choices: [{ message: { content: "{\"blueprint\":true}" } }],
  model: "auto/kimi-k2",
  usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }
};

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

// A + B + C — request mapping, response mapping, json format
{
  let seen: Record<string, unknown> = {};
  let seenAuth: unknown;
  const { server, url } = await stubServer((body, headers) => {
    seen = body;
    seenAuth = headers.authorization;
    return { status: 200, json: okBody };
  });
  const p = new OmniRouteProvider({
    baseUrl: url, apiKey: "sk-test-secret", model: "auto", timeoutMs: 5000
  });
  const res = await p.generate({ ...baseReq, responseFormat: "json" });
  server.close();

  t("A: messages mapped 1:1",
    JSON.stringify(seen.messages) === JSON.stringify(baseReq.messages));
  t("A: temperature + max_tokens mapped",
    seen.temperature === 0.2 && seen.max_tokens === 500);
  t("A: model from config", seen.model === "auto");
  t("B: content+model+usage mapped",
    res.content === "{\"blueprint\":true}" &&
    res.model === "auto/kimi-k2" &&
    res.usage?.totalTokens === 33);
  t("C: response_format json sent",
    JSON.stringify(seen.response_format) ===
      JSON.stringify({ type: "json_object" }));
  t("B: auth header sent", seenAuth === "Bearer sk-test-secret");
  t("B: marked as real (not simulated)",
    res.metadata?.simulated === false &&
    typeof res.metadata?.latencyMs === "number");
}

// request.model overrides config model
{
  let seen: Record<string, unknown> = {};
  const { server, url } = await stubServer(body => {
    seen = body;
    return { status: 200, json: okBody };
  });
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 5000 });
  await p.generate({ ...baseReq, model: "explicit-model" });
  server.close();
  t("A: request.model overrides config", seen.model === "explicit-model");
}

// D — timeout
{
  const { server, url } = await stubServer(() => ({
    status: 200, json: okBody, delayMs: 300
  }));
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 50 });
  t("D: timeout normalized", await expectProviderError("timeout",
    () => p.generate(baseReq)));
  server.close();
}

// E/F — HTTP errors
{
  const { server, url } = await stubServer(() => ({ status: 429 }));
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  t("E: 429 → rate_limited", await expectProviderError("rate_limited",
    () => p.generate(baseReq)));
  server.close();
}
{
  const { server, url } = await stubServer(() => ({ status: 503 }));
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  t("F: 5xx → provider_unavailable", await expectProviderError("provider_unavailable",
    () => p.generate(baseReq)));
  server.close();
}
{
  const { server, url } = await stubServer(() => ({ status: 401 }));
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  t("F: 401 → unauthorized", await expectProviderError("unauthorized",
    () => p.generate(baseReq)));
  server.close();
}

// G — network error
{
  const { server, url } = await stubServer(() => ({ status: 200, json: okBody }));
  server.close(); // close immediately → connection refused
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  t("G: unreachable → network_error", await expectProviderError("network_error",
    () => p.generate(baseReq)));
}

// H — malformed responses
{
  const { server, url } = await stubServer(() => ({ status: 200, json: { nope: 1 } }));
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  t("H: missing choices → invalid_response", await expectProviderError("invalid_response",
    () => p.generate(baseReq)));
  server.close();
}

// I — no API key → no Authorization header
{
  let seenAuth: unknown = "unset";
  const { server, url } = await stubServer((_b, headers) => {
    seenAuth = headers.authorization;
    return { status: 200, json: okBody };
  });
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 2000 });
  await p.generate(baseReq);
  server.close();
  t("I: no key → no Authorization header", seenAuth === undefined);
}

// J — secrets never leak into errors
{
  const { server, url } = await stubServer(() => ({ status: 401 }));
  const secret = "sk-super-secret-value";
  const p = new OmniRouteProvider({ baseUrl: url, apiKey: secret, model: "auto", timeoutMs: 2000 });
  let leaked = false;
  try {
    await p.generate(baseReq);
  } catch (e) {
    leaked = String(e).includes(secret) ||
      String((e as Error).stack ?? "").includes(secret);
  }
  server.close();
  t("J: API key absent from error + stack", !leaked);
  t("J: unconfigured → not_configured", await expectProviderError(
    "not_configured",
    () => new OmniRouteProvider({ baseUrl: "", model: "auto", timeoutMs: 1 })
      .generate(baseReq)));
}

// K + N — mock still works and is marked simulated
{
  const mock = new MockAIProvider();
  const res = await mock.generate({
    messages: [{ role: "user", content: "{}" }]
  });
  t("K: MockAIProvider still works", res.provider === "mock" && res.content.length > 0);
  t("N: mock marked testMode / real marked !simulated",
    res.metadata?.testMode === true);
}

// B5 — structured output: responseSchema → json_schema + strict
{
  let seen: Record<string, unknown> = {};
  const { server, url } = await stubServer(body => {
    seen = body;
    return { status: 200, json: okBody };
  });
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 5000 });
  const schema = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false
  };
  await p.generate({
    ...baseReq,
    responseFormat: "json",
    responseSchema: { name: "ProjectBlueprint", schema }
  });
  server.close();

  const rf = seen.response_format as {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  t("B5: schema → response_format.type json_schema",
    rf?.type === "json_schema");
  t("B5: json_schema.name + strict=true forwarded",
    rf?.json_schema?.name === "ProjectBlueprint" &&
    rf?.json_schema?.strict === true);
  t("B5: schema passed through verbatim",
    JSON.stringify(rf?.json_schema?.schema) === JSON.stringify(schema));
}

{
  let seen: Record<string, unknown> = {};
  const { server, url } = await stubServer(body => {
    seen = body;
    return { status: 200, json: okBody };
  });
  const p = new OmniRouteProvider({ baseUrl: url, model: "auto", timeoutMs: 5000 });
  await p.generate({ ...baseReq, responseFormat: "json" });
  server.close();
  t("B5: no schema → legacy json_object preserved",
    JSON.stringify(seen.response_format) ===
      JSON.stringify({ type: "json_object" }));
}

{
  // schema/contract drift guard — every ProjectBlueprint key must
  // appear in the wire schema so contracts.ts stays the source
  // of truth for both layers.
  const { PROJECT_BLUEPRINT_JSON_SCHEMA } =
    await import("../src/core/strategy/contracts.js");
  const { MockStrategicBrain } =
    await import("../src/core/strategy/providers/mock-strategic-brain.js");
  const bp = await new MockStrategicBrain().analyze({ prompt: "x" });
  const props = Object.keys(
    (PROJECT_BLUEPRINT_JSON_SCHEMA as { properties: object }).properties
  );
  const required = (PROJECT_BLUEPRINT_JSON_SCHEMA as { required: string[] })
    .required;
  const bpKeys = Object.keys(bp);
  t("B5: schema covers every ProjectBlueprint field",
    bpKeys.every(k => props.includes(k)) &&
    props.every(k => bpKeys.includes(k)) &&
    props.every(k => required.includes(k)));
}

// L + M — factory: mock default, omniroute only with URL
{
  t("L: default env → mock",
    createAIProvider({}).id === "mock");
  t("L: explicit mock → mock",
    createAIProvider({ AI_PROVIDER: "mock" }).id === "mock");
  t("M: omniroute without URL → mock (safe degradation)",
    createAIProvider({ AI_PROVIDER: "omniroute" }).id === "mock");
  t("M: omniroute + URL → real provider",
    createAIProvider({ AI_PROVIDER: "omniroute", OMNIROUTE_URL: "http://localhost:20128" }).id === "omniroute");
  t("M: no env AI_PROVIDER → mock (production-safe)",
    createAIProvider({ AI_PROVIDER: undefined }).id === "mock");
}

// R — bounded retry regression (B.8.7): OmniRoute inherits the policy
{
  // 503 → 200: transient retried once, message still says OmniRoute
  let n = 0;
  const { server, url } = await stubServer(() =>
    ++n === 1 ? { status: 503 } : { status: 200, json: okBody });
  const p = new OmniRouteProvider({
    baseUrl: url, apiKey: "k", model: "auto", timeoutMs: 5000
  });
  const res = await p.generate(baseReq);
  server.close();
  t("R: 503 → retry → 200 (2 requests)",
    res.content === "{\"blueprint\":true}" && n === 2);
}
{
  // 401: permanent — exactly one request, message says OmniRoute
  let n = 0;
  const { server, url } = await stubServer(() => {
    n++;
    return { status: 401 };
  });
  const p = new OmniRouteProvider({
    baseUrl: url, apiKey: "k", model: "auto", timeoutMs: 5000
  });
  const e = await p.generate(baseReq).catch(err => err);
  server.close();
  t("R: 401 → no retry, OmniRoute message",
    e instanceof ProviderError && e.code === "unauthorized" &&
      e.message.includes("OmniRoute") && n === 1);
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
