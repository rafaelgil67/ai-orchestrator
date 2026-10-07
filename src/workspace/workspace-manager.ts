/**
 * WorkspaceManager — Phase A of the real-orchestration roadmap.
 *
 * One isolated, ephemeral filesystem workspace per session/project.
 * This module ONLY manages directories and path resolution — it cannot
 * execute code, has no child_process, and never writes into paths the
 * caller did not resolve through it.
 *
 * Safety properties:
 *  - workspace ids are server-generated (`ws_<uuid>`); a user-supplied
 *    ownerId is used only as a map key, never as a path segment;
 *  - resolve() rejects absolute paths, NUL bytes and any `..` that
 *    escapes the workspace, lexically AND via realpath (symlinks);
 *  - workspaces live under rootDir (default: os.tmpdir()) — outside the
 *    repo, outside public/, never served by the HTTP layer;
 *  - cleanup() is idempotent; ops on the same workspace are serialized
 *    through a per-id promise chain;
 *  - everything is auditable via auditTrail().
 *
 * Pending for later phases: byte-quota enforcement (usage() is provided
 * for measurement), TTL policy owned by the caller (sessions TTL),
 * and sandboxed execution (Phase D — containers, not this module).
 */
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export type WorkspaceErrorCode =
  | "invalid_identifier"
  | "workspace_not_found"
  | "workspace_cleaned"
  | "workspace_capacity_reached"
  | "path_outside_workspace"
  | "filesystem_error";

export class WorkspaceError extends Error {
  constructor(
    public readonly code: WorkspaceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface WorkspaceManagerConfig {
  /** Base directory for all workspaces. Default: <os.tmpdir>/ai-orchestrator-workspaces. */
  rootDir: string;
  /** Maximum simultaneous active workspaces. */
  maxWorkspaces: number;
  /** Cap on the in-memory audit trail. */
  auditLogLimit: number;
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceManagerConfig = {
  rootDir: join(tmpdir(), "ai-orchestrator-workspaces"),
  maxWorkspaces: 50,
  auditLogLimit: 1000
};

export type WorkspaceStatus = "active" | "cleaned";

export interface WorkspaceRecord {
  /** Server-generated `ws_<uuid>` — the only path component used on disk. */
  id: string;
  /** Logical owner (e.g. a demo sessionId). Map key only. */
  ownerId: string;
  /** Normalized absolute workspace directory. */
  dir: string;
  createdAt: number;
  status: WorkspaceStatus;
}

export interface WorkspaceAuditEvent {
  at: number;
  op: "create" | "cleanup";
  workspaceId: string;
  ownerId: string;
}

const OWNER_ID_PATTERN = /^[\w-]{4,128}$/;

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly byOwner = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly audit: WorkspaceAuditEvent[] = [];
  private readonly root: string;
  private rootReady = false;

  constructor(
    private readonly config: WorkspaceManagerConfig = DEFAULT_WORKSPACE_CONFIG
  ) {
    this.root = normalize(config.rootDir);
  }

  /**
   * Creates (or returns) the active workspace for an owner. Idempotent:
   * two concurrent create() calls for the same owner resolve to the
   * same record — serialized through the per-owner queue.
   */
  create(ownerId: string): Promise<WorkspaceRecord> {
    if (!OWNER_ID_PATTERN.test(ownerId)) {
      throw new WorkspaceError(
        "invalid_identifier",
        "Owner identifier is not acceptable."
      );
    }
    return this.enqueue(ownerId, () => this.createLocked(ownerId));
  }

  private async createLocked(ownerId: string): Promise<WorkspaceRecord> {
    const existing = this.byOwner.get(ownerId);
    if (existing) {
      const record = this.workspaces.get(existing);
      if (record && record.status === "active") {
        return record;
      }
      this.byOwner.delete(ownerId);
    }
    if (this.activeCount() >= this.config.maxWorkspaces) {
      throw new WorkspaceError(
        "workspace_capacity_reached",
        "Workspace capacity reached."
      );
    }
    if (!this.rootReady) {
      try {
        await mkdir(this.root, { recursive: true });
        this.rootReady = true;
      } catch {
        throw new WorkspaceError(
          "filesystem_error",
          "Workspace root is not writable."
        );
      }
    }
    // UUIDs make collisions practically impossible; retry once anyway.
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = `ws_${randomUUID()}`;
      const dir = normalize(join(this.root, id));
      try {
        await mkdir(dir);
      } catch (error) {
        if (attempt === 0 && this.isExistsError(error)) continue;
        throw new WorkspaceError(
          "filesystem_error",
          "Could not create workspace directory."
        );
      }
      // Defense in depth: the directory must really be inside root.
      if (!(await this.isInside(dir, this.root))) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw new WorkspaceError(
          "filesystem_error",
          "Workspace directory escaped its root."
        );
      }
      const record: WorkspaceRecord = {
        id,
        ownerId,
        dir,
        createdAt: Date.now(),
        status: "active"
      };
      this.workspaces.set(id, record);
      this.byOwner.set(ownerId, id);
      this.log("create", record);
      return record;
    }
    throw new WorkspaceError(
      "filesystem_error",
      "Could not allocate a workspace id."
    );
  }

  /** Record by workspace id. Throws workspace_not_found. */
  get(id: string): WorkspaceRecord {
    const record = this.workspaces.get(id);
    if (!record) {
      throw new WorkspaceError(
        "workspace_not_found",
        "Workspace does not exist."
      );
    }
    return record;
  }

  /** Record by owner id (e.g. sessionId). Throws workspace_not_found. */
  getByOwner(ownerId: string): WorkspaceRecord {
    const id = this.byOwner.get(ownerId);
    if (!id || !this.workspaces.has(id)) {
      throw new WorkspaceError(
        "workspace_not_found",
        "Owner has no workspace."
      );
    }
    return this.workspaces.get(id)!;
  }

  status(id: string): WorkspaceStatus {
    return this.get(id).status;
  }

  exists(id: string): boolean {
    return this.workspaces.get(id)?.status === "active";
  }

  /**
   * Resolves a relative path inside a workspace. Rejects absolute
   * paths, NUL bytes and any escape — checked lexically and against
   * realpaths so symlinks cannot point outside the workspace.
   */
  async resolve(id: string, relPath: string): Promise<string> {
    const record = this.get(id);
    if (record.status !== "active") {
      throw new WorkspaceError(
        "workspace_cleaned",
        "Workspace has been cleaned up."
      );
    }
    if (typeof relPath !== "string" || relPath.includes("\0")) {
      throw new WorkspaceError(
        "path_outside_workspace",
        "Invalid path."
      );
    }
    if (isAbsolute(relPath)) {
      throw new WorkspaceError(
        "path_outside_workspace",
        "Absolute paths are not allowed."
      );
    }
    const candidate = normalize(join(record.dir, relPath));
    if (!this.contained(candidate, record.dir)) {
      throw new WorkspaceError(
        "path_outside_workspace",
        "Path escapes the workspace."
      );
    }
    await this.assertRealContained(candidate, record.dir);
    return candidate;
  }

  /**
   * Removes a workspace. Idempotent: unknown or already-cleaned ids are
   * a no-op. Serialized per workspace so create/cleanup cannot race.
   */
  async cleanup(id: string): Promise<void> {
    const record = this.workspaces.get(id);
    if (!record) return; // never existed — cleanup is a no-op
    await this.enqueue(id, () => this.cleanupLocked(record));
  }

  async cleanupByOwner(ownerId: string): Promise<void> {
    const id = this.byOwner.get(ownerId);
    if (id) await this.cleanup(id);
  }

  async cleanupAll(): Promise<void> {
    for (const record of [...this.workspaces.values()]) {
      await this.cleanup(record.id);
    }
  }

  private async cleanupLocked(record: WorkspaceRecord): Promise<void> {
    if (record.status === "cleaned") return;
    try {
      await rm(record.dir, { recursive: true, force: true });
    } catch {
      throw new WorkspaceError(
        "filesystem_error",
        "Workspace cleanup failed."
      );
    }
    record.status = "cleaned";
    this.log("cleanup", record);
  }

  /** Total bytes under the workspace — measurement for a future quota. */
  async usage(id: string): Promise<number> {
    const record = this.get(id);
    const walk = async (dir: string): Promise<number> => {
      let total = 0;
      let entries: string[] = [];
      try {
        entries = await readdir(dir);
      } catch {
        return 0;
      }
      for (const name of entries) {
        const p = join(dir, name);
        try {
          const st = await lstat(p);
          if (st.isSymbolicLink()) continue; // never follow links
          if (st.isDirectory()) total += await walk(p);
          else total += st.size;
        } catch {
          // entry vanished mid-scan — ignore
        }
      }
      return total;
    };
    return walk(record.dir);
  }

  auditTrail(): readonly WorkspaceAuditEvent[] {
    return this.audit;
  }

  private activeCount(): number {
    let n = 0;
    for (const r of this.workspaces.values()) {
      if (r.status === "active") n += 1;
    }
    return n;
  }

  private contained(candidate: string, dir: string): boolean {
    const c = normalize(candidate);
    return c === dir || c.startsWith(dir + sep);
  }

  private async isInside(candidate: string, dir: string): Promise<boolean> {
    try {
      return this.contained(await realpath(candidate), dir);
    } catch {
      return false;
    }
  }

  /**
   * realpath-based containment: resolves the deepest existing ancestor
   * of `candidate` and verifies it still lives inside `dir`. Catches
   * symlink escapes even for paths that do not exist yet.
   */
  private async assertRealContained(
    candidate: string,
    dir: string
  ): Promise<void> {
    let p = candidate;
    for (;;) {
      try {
        const real = await realpath(p);
        if (!this.contained(normalize(real), dir)) {
          throw new WorkspaceError(
            "path_outside_workspace",
            "Path escapes the workspace through a link."
          );
        }
        return;
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        const parent = dirname(p);
        if (parent === p || !this.contained(parent, dir)) return;
        p = parent;
      }
    }
  }

  private isExistsError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "EEXIST"
    );
  }

  /** Serializes async ops sharing a key (ownerId or workspaceId). */
  private enqueue<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = this.inflight.get(key) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.inflight.set(
      key,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  private log(op: WorkspaceAuditEvent["op"], record: WorkspaceRecord): void {
    this.audit.push({
      at: Date.now(),
      op,
      workspaceId: record.id,
      ownerId: record.ownerId
    });
    if (this.audit.length > this.config.auditLogLimit) {
      this.audit.splice(0, this.audit.length - this.config.auditLogLimit);
    }
  }
}
