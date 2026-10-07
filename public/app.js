/**
 * AI Orchestrator — Interactive Web Demo client.
 * Vanilla JS + EventSource (SSE). The client only sends whitelisted
 * high-level actions (brief, approve/reject, run) and renders DTOs —
 * all orchestration logic lives in the server-side core.
 *
 * UI strings are collected in `strings` so a future locale only needs a
 * second dictionary (see project i18n strategy).
 */
const strings = {
  en: {
    analyzing: "Analyzing…",
    analyze: "Analyze",
    running: "Running…",
    startExecution: "Start execution",
    awaitingApproval: "Awaiting approval",
    completed: "Completed",
    paused: "Paused — human intervention required",
    blocked: "Blocked",
    failed: "Failed",
    rejectedMsg: "Rejected by the human operator — execution refused.",
    awaitingMsg: "The engine stopped at the Approval Gate and did not execute.",
    completedMsg: "All tasks completed and verified.",
    connError: "Connection lost — retrying…",
    unknownError: "Something went wrong. Please try again.",
    errors: {
      invalid_input: "Invalid input. Please check the form.",
      invalid_brief: "Please describe what you want to build.",
      session_not_found: "Demo session not found or expired.",
      session_capacity_reached: "Demo capacity reached — please try again later.",
      approval_required: "Approval is required before execution.",
      invalid_state_transition: "That action is not valid right now.",
      execution_in_progress: "Execution is already in progress.",
      internal_error: "Internal error — please try again."
    }
  }
};
const t = strings.en;

const $ = id => document.getElementById(id);

const state = {
  sessionId: null,
  events: null,
  trace: []
};

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code ?? "internal_error";
    const err = new Error(t.errors[code] ?? t.unknownError);
    err.code = code;
    throw err;
  }
  return data;
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }
function showError(el, error) {
  el.textContent = error.message;
  show(el);
}

// ---- 1. Create demo ----
$("btn-analyze").addEventListener("click", async () => {
  const btn = $("btn-analyze");
  const brief = $("brief").value;
  hide($("brief-error"));
  btn.disabled = true;
  btn.textContent = t.analyzing;
  try {
    const { sessionId } = await api("/api/demo", "POST", {
      brief,
      projectName: $("project-name").value || undefined
    });
    state.sessionId = sessionId;
    connectEvents(sessionId);
    const { session } = await api(`/api/demo/${sessionId}`);
    renderSession(session);
  } catch (error) {
    showError($("brief-error"), error);
  } finally {
    btn.disabled = false;
    btn.textContent = t.analyze;
  }
});

// ---- 2. Approval gate ----
async function decide(action) {
  hide($("approval-error"));
  try {
    const { session } = await api(
      `/api/demo/${state.sessionId}/${action}`,
      "POST",
      { rationale: $("rationale").value || undefined }
    );
    renderSession(session);
  } catch (error) {
    showError($("approval-error"), error);
  }
}
$("btn-approve").addEventListener("click", () => decide("approve"));
$("btn-reject").addEventListener("click", () => decide("reject"));

// ---- 3. Run ----
$("btn-run").addEventListener("click", async () => {
  const btn = $("btn-run");
  btn.disabled = true;
  try {
    await api(`/api/demo/${state.sessionId}/run`, "POST", {});
  } catch {
    btn.disabled = false;
  }
});

// ---- 4. SSE ----
function connectEvents(sessionId) {
  if (state.events) state.events.close();
  const es = new EventSource(`/api/demo/${sessionId}/events`);
  state.events = es;

  es.addEventListener("state", e => {
    renderSession(JSON.parse(e.data).session);
  });
  es.addEventListener("trace", e => {
    appendTrace(JSON.parse(e.data).entry);
  });
  es.addEventListener("done", e => {
    renderDone(JSON.parse(e.data));
  });
}

// ---- Rendering ----
const PHASE_ORDER = ["planning", "execution", "verification", "completed"];
const PHASE_DISPLAY = {
  approval: -1, discovery: -1, diagnosis: -1, revision: -1,
  planning: 0, execution: 1, verification: 2, completed: 3,
  deployment: 3, failed: 3
};

function renderSession(session) {
  const project = session.project;

  // Analysis panel
  if (project.analysis || project.status !== "running") {
    renderAnalysis(project);
  }

  // Approval panel: only while awaiting, and no decision yet recorded
  if (project.status === "awaiting_approval") {
    show($("approval-panel"));
  } else {
    hide($("approval-panel"));
  }

  // Execution panel: visible once approved (running or beyond)
  const approved = project.decisions.some(d => d.decision === "approved");
  if (approved || project.tasks.length > 0) {
    show($("execution-panel"));
    renderStepper(project.phase);
    renderCounters(project.counters);
    renderTasks(project.tasks);
    const runBtn = $("btn-run");
    runBtn.disabled =
      session.running || project.status !== "running";
    runBtn.textContent = session.running ? t.running : t.startExecution;
  }

  // Rejected → show as result
  const rejected = project.decisions.some(d => d.decision === "rejected");
  if (rejected) {
    renderResult("paused", t.paused, t.rejectedMsg);
  }
}

function renderAnalysis(project) {
  show($("analysis-panel"));
  $("analysis-name").textContent = project.name;
  const a = project.analysis;
  $("analysis-summary").textContent =
    a?.executiveSummary ?? project.improvedSpecification ?? project.brief.objective;

  fillList("analysis-requirements",
    (a?.requirements ?? []).map(r => `${r.title}`));
  fillList("analysis-risks",
    (a?.risks ?? []).map(r => `[${r.level}] ${r.description}`));
  fillList("analysis-recommendations",
    (a?.recommendations ?? []).map(r => r.title));
}

function fillList(id, items) {
  const ul = $(id);
  ul.innerHTML = "";
  for (const item of items.slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
}

function renderStepper(phase) {
  const idx = PHASE_DISPLAY[phase] ?? -1;
  document.querySelectorAll("#phase-stepper li").forEach((li, i) => {
    li.classList.toggle("done", i < idx);
    li.classList.toggle("active", i === idx);
  });
}

function renderCounters(counters) {
  $("c-cycles").textContent = counters.cycles;
  $("c-retries").textContent = counters.retries;
  $("c-repairs").textContent = counters.repairs;
  $("c-replans").textContent = counters.replans;
}

function renderTasks(tasks) {
  const ul = $("task-list");
  ul.innerHTML = "";
  for (const task of tasks) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `dot ${task.status}`;
    const title = document.createElement("span");
    title.className = "t-title";
    title.textContent = task.title;
    title.title = task.title;
    const meta = document.createElement("span");
    meta.className = "t-meta";
    const attempts = task.attempts > 0 ? ` · ${task.attempts}×` : "";
    meta.textContent = `${task.role} · ${task.status}${attempts}`;
    li.append(dot, title, meta);
    ul.appendChild(li);
  }
}

function appendTrace(entry) {
  state.trace.push(entry);
  const ol = $("trace-list");
  const li = document.createElement("li");
  const head = document.createElement("b");
  head.textContent =
    `[${entry.cycle}] ${entry.phaseFrom} → ${entry.phaseTo} · ${entry.action}`;
  const outcome = document.createElement("span");
  outcome.className = "t-outcome";
  outcome.textContent = `${entry.outcome} — ${entry.reason}`;
  li.append(head, outcome);
  ol.appendChild(li);
  ol.scrollTop = ol.scrollHeight;
}

function renderDone({ stoppedReason }) {
  const map = {
    completed: ["completed", t.completed, t.completedMsg],
    paused: ["paused", t.paused, ""],
    blocked: ["blocked", t.blocked, ""],
    failed: ["failed", t.failed, ""],
    awaiting_approval: ["paused", t.awaitingApproval, t.awaitingMsg],
    max_cycles: ["blocked", "Stopped at the safety cycle limit", ""]
  };
  const [cls, title, detail] = map[stoppedReason] ??
    ["blocked", stoppedReason, ""];
  renderResult(cls, title, detail);
  $("btn-run").disabled = true;
}

function renderResult(cls, title, detail) {
  const panel = $("result-panel");
  panel.className = `card ${cls}`;
  $("result-title").textContent = title;
  $("result-detail").textContent = detail;
  show(panel);
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
