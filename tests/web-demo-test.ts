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
import { Server } from "node:http";

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
} finally {
  server.close();
}

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
