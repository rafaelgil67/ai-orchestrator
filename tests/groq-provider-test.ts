/**
 * Groq provider suite — Phase B.8.1. Verifies factory selection,
 * direct OpenAI-compatible wire format (json_schema + strict),
 * auth handling, error normalization and secret hygiene for the
 * direct Groq path. Uses a local stub HTTP server — no real
 * Groq call and no real key needed.
 */
import { createServer, Server } from "node:http";
import {
  GroqProvider,
  GROQ_API_BASE_URL,
  GROQ_DEFAULT_MODEL
} from "../src/agents/providers/groq-provider.js";
import {
  OmniRouteProvider,
  ProviderError
} from "../src/agents/providers/omniroute-provider.js";
import { MockAIProvider } from "../src/agents/providers/mock-provider.js";
import { createAIProvider } from "../src/agents/providers/provider-factory.js";
import { AIRequest } from "../src/agents/contracts/ai-provider.js";
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
  ]
};

const okBody = {
  choices: [{ message: { content: "{\"ok\":true}" } }],
  model: "openai/gpt-oss-120b",
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
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

// A — factory selection
{
  t("A: AI_PROVIDER=groq + key → GroqProvider",
    createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "sk-t" })
      instanceof GroqProvider);
  t("A: groq provider id is 'groq' (not 'omniroute')",
    createAIProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "sk-t" }).id
      === "groq");
  const unconfigured = createAIProvider({ AI_PROVIDER: "groq" });
  t("A: groq sin key → NO mock (GroqProvider explícito)",
    unconfigured instanceof GroqProvider &&
      unconfigured.id === "groq");
  t("A: groq sin key → generate() lanza not_configured",
    await expectProviderError("not_configured", () =>
      unconfigured.generate(baseReq)));
  t("A: mock default intacto",
    createAIProvider({}).id === "mock");
  t("A: AI_PROVIDER=omniroute+URL → OmniRouteProvider",
    createAIProvider({
      AI_PROVIDER: "omniroute",
      OMNIROUTE_URL: "http://localhost:20128"
    }).id === "omniroute");
  t("A: provider desconocido → mock",
    createAIProvider({ AI_PROVIDER: "nonsense" }).id === "mock");
}

// B — structured output wire format against Groq endpoint
{
  let seen: Record<string, unknown> = {};
  let seenAuth: unknown;
  let seenUrl: unknown;
  const { server, url } = await stubServer((body, headers) => {
    seen = body;
    seenAuth = headers.authorization;
    return { status: 200, json: okBody };
  });
  const p = new GroqProvider({
    baseUrl: url,
    apiKey: "gsk_test_secret",
    model: "openai/gpt-oss-120b",
    timeoutMs: 5000
  });
  const res = await p.generate({
    ...baseReq,
    responseFormat: "json",
    responseSchema: {
      name: "ProjectBlueprint",
      schema: PROJECT_BLUEPRINT_JSON_SCHEMA
    }
  });
  server.close();

  const rf = seen.response_format as {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  t("B: response_format.type === json_schema", rf?.type === "json_schema");
  t("B: json_schema.name === ProjectBlueprint",
    rf?.json_schema?.name === "ProjectBlueprint");
  t("B: json_schema.strict === true", rf?.json_schema?.strict === true);
  t("B: schema === PROJECT_BLUEPRINT_JSON_SCHEMA verbatim",
    JSON.stringify(rf?.json_schema?.schema) ===
      JSON.stringify(PROJECT_BLUEPRINT_JSON_SCHEMA));
  t("B: model passed through",
    seen.model === "openai/gpt-oss-120b");
  t("B: response marked real",
    res.metadata?.simulated === false && res.provider === "groq");
}

// C — auth header + default endpoint constants
{
  let seenAuth: unknown;
  const { server, url } = await stubServer((_b, headers) => {
    seenAuth = headers.authorization;
    return { status: 200, json: okBody };
  });
  const p = new GroqProvider({
    baseUrl: url, apiKey: "gsk_test_secret", model: "m", timeoutMs: 5000
  });
  await p.generate(baseReq);
  server.close();
  t("C: Authorization Bearer enviado",
    seenAuth === "Bearer gsk_test_secret");
  t("C: default baseUrl es api.groq.com/openai",
    GROQ_API_BASE_URL === "https://api.groq.com/openai");
  t("C: default model gpt-oss-120b",
    GROQ_DEFAULT_MODEL === "openai/gpt-oss-120b");
}

// D — legacy: no responseSchema → json_object
{
  let seen: Record<string, unknown> = {};
  const { server, url } = await stubServer(body => {
    seen = body;
    return { status: 200, json: okBody };
  });
  const p = new GroqProvider({
    baseUrl: url, apiKey: "k", model: "m", timeoutMs: 5000
  });
  await p.generate({ ...baseReq, responseFormat: "json" });
  server.close();
  t("D: sin schema → json_object legacy",
    JSON.stringify(seen.response_format) ===
      JSON.stringify({ type: "json_object" }));
}

// E — error normalization
{
  const check = async (status: number, code: string) => {
    const { server, url } = await stubServer(() => ({ status }));
    const p = new GroqProvider({
      baseUrl: url, apiKey: "k", model: "m", timeoutMs: 2000
    });
    const ok = await expectProviderError(code, () => p.generate(baseReq));
    server.close();
    return ok;
  };
  t("E: 401/403 → unauthorized", await check(401, "unauthorized") &&
    await check(403, "unauthorized"));
  t("E: 400 → bad_request", await check(400, "bad_request"));
  t("E: 429 → rate_limited", await check(429, "rate_limited"));
  t("E: 503 → provider_unavailable", await check(503, "provider_unavailable"));

  const { server, url } = await stubServer(() => ({
    status: 200, json: okBody, delayMs: 300
  }));
  const slow = new GroqProvider({
    baseUrl: url, apiKey: "k", model: "m", timeoutMs: 50
  });
  t("E: timeout → timeout",
    await expectProviderError("timeout", () => slow.generate(baseReq)));
  server.close();

  // Error messages must name the real provider, not the transport.
  const msg = async (mk: (url: string) => OmniRouteProvider) => {
    const { server: s, url } = await stubServer(() => ({ status: 401 }));
    const e = await mk(url).generate(baseReq).catch(err => err);
    s.close();
    return e instanceof Error ? e.message : "";
  };
  const groqMsg = await msg(
    url => new GroqProvider({
      baseUrl: url, apiKey: "k", model: "m", timeoutMs: 2000
    }));
  t("E: 401 message identifica Groq",
    groqMsg.includes("Groq") && !groqMsg.includes("OmniRoute"));
  const omniMsg = await msg(
    url => new OmniRouteProvider({
      baseUrl: url, model: "m", timeoutMs: 2000
    }));
  t("E: 401 OmniRoute message sigue diciendo OmniRoute",
    omniMsg.includes("OmniRoute") && !omniMsg.includes("Groq"));

  for (const [status, code] of [[400, "bad_request"], [503, "provider_unavailable"]] as const) {
    const { server: s, url } = await stubServer(() => ({ status }));
    const e = await new GroqProvider({
      baseUrl: url, apiKey: "k", model: "m", timeoutMs: 2000
    }).generate(baseReq).catch(err => err);
    s.close();
    t(`E: ${status} message identifica Groq (${code})`,
      e instanceof ProviderError && e.code === code &&
        e.message.includes("Groq"));
  }

  const { server: s2, url: u2 } = await stubServer(() => ({
    status: 200, json: okBody
  }));
  s2.close();
  const dead = new GroqProvider({
    baseUrl: u2, apiKey: "k", model: "m", timeoutMs: 2000
  });
  t("E: network → network_error",
    await expectProviderError("network_error", () => dead.generate(baseReq)));
}

// F — secret hygiene: key never in errors/metadata
{
  const secret = "gsk_super_secret_value";
  const { server, url } = await stubServer(() => ({ status: 401 }));
  const p = new GroqProvider({
    baseUrl: url, apiKey: secret, model: "m", timeoutMs: 2000
  });
  let leaked = false;
  try {
    await p.generate(baseReq);
  } catch (e) {
    leaked = String(e).includes(secret) ||
      String((e as Error).stack ?? "").includes(secret);
  }
  server.close();
  t("F: GROQ_API_KEY ausente de error+stack", !leaked);
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
