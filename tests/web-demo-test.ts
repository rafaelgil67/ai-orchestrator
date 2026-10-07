/**
 * Web demo suite — exercises the interactive demo API end-to-end against
 * a real server on an ephemeral port: health, create, validation,
 * approval gate, step-driven run, session mutex, isolation, SSE, trace,
 * and the client-input security boundary.
 */
import { startDemoServer } from "../src/web/server.js";
import {
  DemoSessionService,
  DEFAULT_SESSION_CONFIG
} from "../src/web/sessions.js";
import { Server, get, IncomingMessage } from "node:http";

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

const TEST_CONFIG = {
  ...DEFAULT_SESSION_CONFIG,
  stepDelayMs: 5,
  ttlMs: 60_000
};

async function post(url: string, body?: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
}

async function createDemo(base: string): Promise<string> {
  const res = await post(`${base}/api/demo`, { brief: "Build a demo app" });
  const data = await res.json();
  return data.sessionId;
}

const { server, url } = await startDemoServer(0, TEST_CONFIG);

try {
  // ---- Health ----
  const health = await fetch(`${url}/api/health`);
  const healthBody = await health.json();
  t(
    "GET /api/health → 200 {status:ok}",
    health.status === 200 && healthBody.status === "ok"
  );

  // ---- Create: valid ----
  const created = await post(`${url}/api/demo`, {
    brief: "Build a small REST API",
    projectName: "Suite Project"
  });
  const createdBody = await created.json();
  t(
    "POST /api/demo → 201 + sessionId",
    created.status === 201 && typeof createdBody.sessionId === "string"
  );
  const sid = createdBody.sessionId;

  // ---- Create: validation ----
  t(
    "empty brief → 400",
    (await post(`${url}/api/demo`, { brief: "" })).status === 400
  );
  t(
    "missing brief → 400",
    (await post(`${url}/api/demo`, {})).status === 400
  );
  t(
    "brief >4KB → 400",
    (await post(`${url}/api/demo`, { brief: "x".repeat(5000) }))
      .status === 400
  );
  t(
    "non-object body → 400",
    (await post(`${url}/api/demo`, ["not", "an", "object"]))
      .status === 400
  );

  // ---- Security boundary: forbidden fields are rejected, not applied ----
  const forbidden = await post(`${url}/api/demo`, {
    brief: "x",
    maxCycles: 99999,
    maxRetries: 99,
    phase: "completed",
    status: "completed"
  });
  const forbiddenBody = await forbidden.json();
  t(
    "forbidden fields (maxCycles/phase/status) → 400",
    forbidden.status === 400 &&
      forbiddenBody?.error?.code === "invalid_input"
  );

  // ---- Session state ----
  const getRes = await fetch(`${url}/api/demo/${sid}`);
  const { session } = await getRes.json();
  t("GET session → 200", getRes.status === 200);
  t(
    "project awaits approval after analyze",
    session?.project?.status === "awaiting_approval" &&
      session?.project?.phase === "approval"
  );
  t(
    "DTO exposes analysis, hides metadata",
    session?.project?.analysis !== undefined &&
      session?.project?.metadata === undefined
  );
  t(
    "unknown session → 404",
    (await fetch(`${url}/api/demo/demo_nope`)).status === 404
  );

  // R-01 regression: /events on a nonexistent session must answer 404
  // JSON — never a 200 empty SSE stream (which would make EventSource
  // reconnect forever).
  const ghostEvents = await fetch(`${url}/api/demo/demo_nope/events`);
  const ghostBody = await ghostEvents.json();
  t(
    "GET /events on nonexistent session → 404 JSON, not SSE",
    ghostEvents.status === 404 &&
      ghostBody?.error?.code === "session_not_found" &&
      !ghostEvents.headers
        .get("content-type")
        ?.includes("text/event-stream")
  );

  // ---- Run requires approval ----
  const earlyRun = await post(`${url}/api/demo/${sid}/run`);
  t(
    "run before approval → 409 approval_required",
    earlyRun.status === 409 &&
      (await earlyRun.json())?.error?.code === "approval_required"
  );

  // ---- Approval ----
  const approve = await post(`${url}/api/demo/${sid}/approve`, {
    rationale: "suite approval"
  });
  t("approve → 200", approve.status === 200);
  const approveSession = (await approve.json()).session;
  t(
    "approval recorded via real gate (decision + running)",
    approveSession?.project?.status === "running" &&
      approveSession.project.decisions.some(
        (d: { decision: string }) => d.decision === "approved"
      )
  );
  t(
    "double approve → 409",
    (await post(`${url}/api/demo/${sid}/approve`)).status === 409
  );

  // ---- SSE + step-driven execution ----
  const sseController = new AbortController();
  const sseEvents: string[] = [];
  const ssePromise = (async () => {
    const res = await fetch(`${url}/api/demo/${sid}/events`, {
      signal: sseController.signal
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const m of buffer.matchAll(/event: (\w+)/g)) {
        sseEvents.push(m[1]);
      }
      if (sseEvents.includes("done")) break;
    }
  })();

  const run = await post(`${url}/api/demo/${sid}/run`);
  t("POST run → 202", run.status === 202);

  // Mutex: a second run while the first is in flight → 409
  const run2 = await post(`${url}/api/demo/${sid}/run`);
  const run2Body = await run2.json();
  t(
    "concurrent run → 409 execution_in_progress",
    run2.status === 409 &&
      run2Body?.error?.code === "execution_in_progress"
  );

  await ssePromise;
  sseController.abort();

  t("SSE received state events", sseEvents.includes("state"));
  t("SSE received trace events", sseEvents.includes("trace"));
  t("SSE received task events", sseEvents.includes("task"));
  t("SSE received phase events", sseEvents.includes("phase"));
  t("SSE received done event", sseEvents.includes("done"));

  const finalRes = await fetch(`${url}/api/demo/${sid}`);
  const finalSession = (await finalRes.json()).session;
  t(
    "final state is completed",
    finalSession?.project?.status === "completed" &&
      finalSession?.project?.phase === "completed"
  );
  t(
    "tasks are real and completed",
    finalSession?.project?.tasks?.length > 0 &&
      finalSession.project.tasks.every(
        (task: { status: string }) => task.status === "completed"
      )
  );

  const traceRes = await fetch(`${url}/api/demo/${sid}/trace`);
  const traceBody = await traceRes.json();
  t(
    "trace endpoint returns real autonomyTrace",
    traceRes.status === 200 &&
      Array.isArray(traceBody.autonomyTrace) &&
      traceBody.autonomyTrace.length > 0
  );
  t(
    "run on terminal session → 409",
    (await post(`${url}/api/demo/${sid}/run`)).status === 409
  );

  // ---- Isolation: second session unaffected by the first ----
  const sidB = await createDemo(url);
  const sessionB = (await (
    await fetch(`${url}/api/demo/${sidB}`)
  ).json()).session;
  t(
    "two sessions stay isolated",
    sidB !== sid &&
      sessionB?.project?.status === "awaiting_approval" &&
      sessionB?.project?.tasks?.length === 0
  );

  // ---- Reject path ----
  const sidC = await createDemo(url);
  const rejectRes = await post(`${url}/api/demo/${sidC}/reject`, {
    rationale: "not yet"
  });
  const rejectSession = (await rejectRes.json()).session;
  t(
    "reject → paused + rejected decision",
    rejectRes.status === 200 &&
      rejectSession?.project?.status === "paused" &&
      rejectSession.project.decisions.some(
        (d: { decision: string }) => d.decision === "rejected"
      )
  );
  t(
    "run after reject → 409",
    (await post(`${url}/api/demo/${sidC}/run`)).status === 409
  );

  // ---- Session capacity ----
  const capped = new DemoSessionService({
    ...TEST_CONFIG,
    maxSessions: 1
  });
  await capped.create("one");
  let capError: { status?: number } = {};
  try {
    await capped.create("two");
  } catch (error) {
    capError = error as { status?: number };
  }
  t("session cap → 429", capError.status === 429);

  // ---- TTL expiry ----
  const ttlService = new DemoSessionService({
    ...TEST_CONFIG,
    ttlMs: 50
  });
  const expiring = await ttlService.create("temp");
  await new Promise(r => setTimeout(r, 80));
  const expiredCount = ttlService.expireStale();
  t(
    "TTL expires inactive sessions",
    expiredCount === 1 && ttlService.size === 0
  );
  void expiring;

  // ---- Static frontend ----
  const index = await fetch(`${url}/`);
  const indexHtml = await index.text();
  t(
    "GET / serves the demo frontend",
    index.status === 200 &&
      indexHtml.includes("AI Orchestrator")
  );
  t(
    "path traversal is blocked",
    (await fetch(`${url}/../package.json`)).status === 404 ||
      (await fetch(`${url}/%2e%2e/package.json`)).status === 404
  );

  // ================= 6G.2 hardening =================

  // ---- R-05: strict CSP ----
  const cspRes = await fetch(`${url}/`);
  const csp = cspRes.headers.get("content-security-policy") ?? "";
  t(
    "CSP is strict (no unsafe-inline, all directives present)",
    !csp.includes("unsafe-inline") &&
      csp.includes("script-src 'self'") &&
      csp.includes("style-src 'self'") &&
      csp.includes("connect-src 'self'") &&
      csp.includes("object-src 'none'") &&
      csp.includes("base-uri 'none'") &&
      csp.includes("frame-ancestors 'none'")
  );

  // ---- R-07: Content-Type policy (needs ≥2 free IP slots → own server)
  const ct = await startDemoServer(0, TEST_CONFIG);
  try {
    t(
      "application/json → 201",
      (await post(`${ct.url}/api/demo`, { brief: "ok" })).status === 201
    );
    t(
      "json; charset=utf-8 → 201",
      (
        await fetch(`${ct.url}/api/demo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({ brief: "ok" })
        })
      ).status === 201
    );
    for (const [ct2, label] of [
      ["text/plain", "text/plain"],
      ["application/x-www-form-urlencoded", "urlencoded"],
      ["multipart/form-data", "multipart"]
    ] as const) {
      const res = await fetch(`${ct.url}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": ct2 },
        body: JSON.stringify({ brief: "x" })
      });
      t(`${label} → 415`, res.status === 415 &&
        (await res.json())?.error?.code === "unsupported_media_type");
    }
    t(
      "no Content-Type + body → 415",
      (
        await fetch(`${ct.url}/api/demo`, {
          method: "POST",
          headers: { "Content-Type": "" },
          body: JSON.stringify({ brief: "x" })
        })
      ).status === 415
    );
  } finally {
    ct.server.close();
  }

  // ---- R-04: per-IP session cap + X-Forwarded-For policy ----
  const ipSrv = await startDemoServer(0, TEST_CONFIG);
  try {
    for (let i = 0; i < 3; i++) {
      await post(`${ipSrv.url}/api/demo`, { brief: `s${i}` });
    }
    const fourth = await post(`${ipSrv.url}/api/demo`, { brief: "s3" });
    t(
      "4th session from same IP → 429",
      fourth.status === 429 &&
        (await fourth.json())?.error?.code === "rate_limited"
    );
    // XFF must be IGNORED without TRUST_PROXY — spoofing cannot bypass
    const spoof = await fetch(`${ipSrv.url}/api/demo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.9"
      },
      body: JSON.stringify({ brief: "spoof" })
    });
    t("X-Forwarded-For ignored by default → still 429",
      spoof.status === 429);
  } finally {
    ipSrv.server.close();
  }

  const proxySrv = await startDemoServer(0, TEST_CONFIG, {
    trustProxy: true
  });
  try {
    // Distinct XFF identities each get their own cap
    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${proxySrv.url}/api/demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `10.0.0.${i}`
        },
        body: JSON.stringify({ brief: "xff" })
      });
      if (res.status !== 201) {
        t(`TRUST_PROXY distinct IP ${i} → 201`, false);
        break;
      }
    }
    t("TRUST_PROXY: 4 distinct IPs → 4 sessions", true);
    // Same forwarded IP hits its own cap at 4th create
    for (let i = 0; i < 3; i++) {
      await fetch(`${proxySrv.url}/api/demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.9.9.9"
        },
        body: JSON.stringify({ brief: "xff" })
      });
    }
    const overCap = await fetch(`${proxySrv.url}/api/demo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "10.9.9.9"
      },
      body: JSON.stringify({ brief: "xff" })
    });
    t("TRUST_PROXY: same forwarded IP → 429 at cap",
      overCap.status === 429);
  } finally {
    proxySrv.server.close();
  }

  // ---- R-02 heartbeat + R-03 listener caps (fast heartbeat config) ----
  const sseSrv = await startDemoServer(0, {
    ...TEST_CONFIG,
    heartbeatIntervalMs: 60,
    maxListenersPerSession: 3,
    maxSseListeners: 4
  });
  const openConns: Array<() => void> = [];
  const openSse = (u: string) =>
    new Promise<{ status: number; ctype: string; body: IncomingMessage }>(
      (resolve, reject) => {
        const req = get(u, res => {
          const chunks: string[] = [];
          res.on("data", c => chunks.push(c.toString()));
          resolve({
            status: res.statusCode ?? 0,
            ctype: res.headers["content-type"] ?? "",
            body: res as IncomingMessage & { _c?: string[] }
          });
          // keep raw chunks accessible via a side channel
          (res as unknown as { _c?: string[] })._c = chunks;
        });
        req.on("error", reject);
        openConns.push(() => req.destroy());
      }
    );

  try {
    const hsid = (await (
      await post(`${sseSrv.url}/api/demo`, { brief: "hb" })
    ).json()).sessionId;

    // R-03 per-session cap: 3 OK → 4th 429
    const conns = [];
    for (let i = 0; i < 3; i++) {
      conns.push(await openSse(`${sseSrv.url}/api/demo/${hsid}/events`));
    }
    t(
      "listeners up to cap → 200 SSE",
      conns.every(c => c.status === 200)
    );
    // global cap is 4 and 3 are open → 1 more slot elsewhere? per-session
    // cap (3) hits first for the SAME session:
    const over = await fetch(`${sseSrv.url}/api/demo/${hsid}/events`);
    t(
      "listener cap+1 → 429, not SSE",
      over.status === 429 &&
        !over.headers.get("content-type")?.includes("text/event-stream")
    );
    void (await over.text());

    // R-02 heartbeat: idle connection receives ": ping" comments
    await new Promise(r => setTimeout(r, 300));
    const chunks = (
      conns[0].body as unknown as { _c?: string[] }
    )._c?.join("") ?? "";
    t(
      "SSE heartbeat emits ': ping' on idle connection",
      chunks.includes(": ping")
    );
    t(
      "heartbeat is a comment, not an event",
      !chunks.includes("event: ping")
    );

    // Close one conn → slot frees (deterministic: we control destroy)
    conns[0].body.destroy();
    await new Promise(r => setTimeout(r, 120));
    const freedConn = await openSse(
      `${sseSrv.url}/api/demo/${hsid}/events`
    );
    t("closed listener frees slot → 200", freedConn.status === 200);
    freedConn.body.destroy();
    await new Promise(r => setTimeout(r, 120));
    // Back to exactly 2 listeners (conns[1], conns[2]).

    // R-03 global cap (maxSseListeners=4): fill 2 remaining slots on a
    // second session → next connection must hit the global cap.
    const gs = (await (
      await post(`${sseSrv.url}/api/demo`, { brief: "g" })
    ).json()).sessionId;
    await openSse(`${sseSrv.url}/api/demo/${gs}/events`); // total=3
    await openSse(`${sseSrv.url}/api/demo/${gs}/events`); // total=4
    const globalOver = await fetch(
      `${sseSrv.url}/api/demo/${gs}/events`
    );
    t(
      "global listener cap → 429, not SSE",
      globalOver.status === 429 &&
        !globalOver.headers
          .get("content-type")
          ?.includes("text/event-stream")
    );
    void (await globalOver.text());
  } finally {
    for (const close of openConns) close();
    sseSrv.server.close();
  }
} finally {
  server.close();
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
