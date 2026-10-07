/**
 * Workspace manager suite — Phase A. Proves isolation, traversal
 * resistance, idempotent cleanup, concurrency and that workspaces are
 * never reachable through the HTTP layer.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WorkspaceManager, WorkspaceError } from "../src/workspace/workspace-manager.js";
import { startDemoServer } from "../src/web/server.js";

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

const root = join(tmpdir(), `ws-test-${randomUUID()}`);
const mgr = new WorkspaceManager({ rootDir: root, maxWorkspaces: 50, auditLogLimit: 100 });

const expectError = async (
  code: string,
  op: () => unknown
): Promise<boolean> => {
  try {
    await op();
    return false;
  } catch (error) {
    return error instanceof WorkspaceError && error.code === code;
  }
};

// A — creation
const wsA = await mgr.create("demo_owner_a");
t("A: workspace created on disk", existsSync(wsA.dir));
t("A: status active + under root",
  wsA.status === "active" && wsA.dir.startsWith(root));

// B — isolation between owners
const wsB = await mgr.create("demo_owner_b");
t("B: two owners get different workspaces", wsA.dir !== wsB.dir);

// C — a workspace cannot reach another's files
writeFileSync(join(wsB.dir, "secret.txt"), "b-data");
t("C: cross-workspace traversal rejected", await expectError(
  "path_outside_workspace",
  () => mgr.resolve(wsA.id, `../${wsB.id}/secret.txt`)
));

// D — path traversal rejected
for (const p of ["../x", "../../etc/passwd", "a/../../b", "..\\..\\evil"]) {
  t(`D: traversal rejected (${p})`, await expectError(
    "path_outside_workspace", () => mgr.resolve(wsA.id, p)));
}

// E — absolute paths rejected
t("E: absolute path rejected", await expectError(
  "path_outside_workspace",
  () => mgr.resolve(wsA.id, join(root, "abs.txt"))
));

// legitimate nested path resolves fine
t("resolve: nested path inside workspace",
  (await mgr.resolve(wsA.id, "src/index.ts")).startsWith(wsA.dir));

// symlink escape (best-effort — Windows may refuse to create links)
let symlinkTested = false;
try {
  const outside = join(root, "outside-target");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(wsA.dir, "escape"), "junction");
  symlinkTested = true;
} catch { /* platform cannot create links — skip */ }
if (symlinkTested) {
  t("symlink escape rejected", await expectError(
    "path_outside_workspace",
    () => mgr.resolve(wsA.id, "escape/leak.txt")
  ));
} else {
  t("symlink escape rejected (skipped: links unsupported)", true);
}

// F — cleanup removes the directory
await mgr.cleanup(wsB.id);
t("F: cleanup removes workspace dir", !existsSync(wsB.dir));
t("F: status becomes cleaned", mgr.status(wsB.id) === "cleaned");
t("F: resolve on cleaned workspace fails", await expectError(
  "workspace_cleaned", () => mgr.resolve(wsB.id, "x")));

// G — cleanup of unknown id is a safe no-op
await mgr.cleanup("ws_nonexistent");
t("G: cleanup of unknown workspace is idempotent", true);

// I — invalid identifiers
t("I: traversal owner id rejected", await expectError(
  "invalid_identifier", () => mgr.create("../evil")));
t("I: unknown workspace id rejected", await expectError(
  "workspace_not_found", () => mgr.get("ws_nope")));

// Concurrency — same owner, parallel creates → one workspace
const [c1, c2] = await Promise.all([
  mgr.create("demo_owner_c"),
  mgr.create("demo_owner_c")
]);
t("concurrency: parallel creates dedupe", c1.id === c2.id);

// Capacity
const tiny = new WorkspaceManager({ rootDir: root, maxWorkspaces: 1, auditLogLimit: 10 });
await tiny.create("cap_a");
t("capacity: maxWorkspaces enforced", await expectError(
  "workspace_capacity_reached", () => tiny.create("cap_b")));
await tiny.cleanupAll();

// J — filesystem errors surface as filesystem_error
const fileRoot = join(root, "a-file");
writeFileSync(fileRoot, "x");
const broken = new WorkspaceManager({ rootDir: join(fileRoot, "sub"), maxWorkspaces: 5, auditLogLimit: 10 });
t("J: unwritable root → filesystem_error", await expectError(
  "filesystem_error", () => broken.create("j_owner")));

// usage() measures bytes without following links
writeFileSync(join(wsA.dir, "data.bin"), "x".repeat(100));
t("usage: byte count", (await mgr.usage(wsA.id)) >= 100);

// audit trail records lifecycle
const ops = mgr.auditTrail().map(e => e.op);
t("audit: create+cleanup recorded",
  ops.includes("create") && ops.includes("cleanup"));

// H — workspaces are never served over HTTP
{
  const { server, url, sessions } = await startDemoServer(0, undefined, { workspaces: mgr });
  try {
    const res = await fetch(`${url}/api/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: "workspace http exposure check" })
    });
    const { sessionId } = await res.json();
    const ws = mgr.getByOwner(sessionId);
    writeFileSync(join(ws.dir, "hidden.txt"), "not public");
    const leak = await fetch(`${url}/hidden.txt`);
    const escaped = await fetch(`${url}/../${ws.id}/hidden.txt`);
    t("H: workspace file not served (404)", leak.status === 404);
    t("H: traversal over HTTP not served", escaped.status !== 200);
    t("H: session DTO does not expose workspace",
      !JSON.stringify(await (await fetch(`${url}/api/demo/${sessionId}`)).json())
        .includes(ws.id));
  } finally {
    server.close();
    await mgr.cleanupAll();
    void sessions;
  }
}

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed · ${failed} failed\n`);
if (failed > 0) process.exit(1);
void dirname(fileURLToPath(import.meta.url));
