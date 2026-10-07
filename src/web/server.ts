/**
 * Interactive Web Demo — zero-dependency HTTP server.
 *
 *   Browser ──HTTP+JSON+SSE──► this server ──► DemoSessionService ──► core
 *
 * Same-origin only: serves the static frontend and /api/* from one Node
 * process, so no CORS is needed. The core engine is never touched — this
 * layer only provides transport, sessions and serialization.
 */
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import {
  DemoSessionService,
  DEFAULT_SESSION_CONFIG,
  SessionConfig
} from "./sessions.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { serializeTrace } from "./dto.js";
import {
  assertJsonContentType,
  parseCreateBody,
  parseDecisionBody,
  parseEmptyBody,
  readBody
} from "./validation.js";
import { ApiError, errorBody, toApiError } from "./errors.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data:; connect-src 'self'; object-src 'none'; " +
    "base-uri 'none'; frame-ancestors 'none'"
};

/**
 * R-04: conservative client IP extraction. X-Forwarded-For is honored
 * ONLY when trustProxy is enabled (trusted reverse proxy); otherwise the
 * socket address is authoritative. IPv4-mapped IPv6 is normalized so
 * "::ffff:127.0.0.1" and "127.0.0.1" count as the same client.
 */
export function clientIpOf(
  req: IncomingMessage,
  trustProxy: boolean
): string {
  let ip: string | undefined;
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (
      Array.isArray(forwarded) ? forwarded[0] : forwarded ?? ""
    )
      .split(",")[0]
      .trim();
    ip = first || req.socket.remoteAddress;
  } else {
    ip = req.socket.remoteAddress;
  }
  return (ip ?? "unknown").replace(/^::ffff:/, "");
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(PUBLIC_DIR, rel));

  // Path traversal guard: the resolved file must stay inside PUBLIC_DIR.
  if (!filePath.startsWith(normalize(PUBLIC_DIR))) {
    throw new ApiError(404, "not_found", "Not found.");
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      ...SECURITY_HEADERS
    });
    res.end(content);
  } catch {
    throw new ApiError(404, "not_found", "Not found.");
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: DemoSessionService,
  trustProxy: boolean
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // ---- Health ----
  if (method === "GET" && path === "/api/health") {
    json(res, 200, { status: "ok" });
    return;
  }

  // ---- Create demo ----
  if (method === "POST" && path === "/api/demo") {
    assertJsonContentType(req);
    const input = parseCreateBody(await readBody(req));
    const session = await sessions.create(
      input.brief,
      input.projectName,
      clientIpOf(req, trustProxy)
    );
    json(res, 201, { sessionId: session.id });
    return;
  }

  const match = path.match(/^\/api\/demo\/([^/]+)(\/(approve|reject|run|events|trace))?$/);
  if (match) {
    const sessionId = match[1];
    const action = match[3] as string | undefined;

    if (method === "GET" && !action) {
      const session = sessions.get(sessionId);
      json(res, 200, { session: sessions.serialize(session) });
      return;
    }

    if (method === "GET" && action === "trace") {
      const session = sessions.get(sessionId);
      json(res, 200, {
        autonomyTrace: serializeTrace(
          sessions.project(session).autonomyTrace
        )
      });
      return;
    }

    if (method === "GET" && action === "events") {
      // Validate the session AND the listener caps BEFORE committing to
      // a 200 SSE response — failures must answer 404/429 JSON, never
      // an empty stream.
      sessions.assertSubscribable(sessionId);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...SECURITY_HEADERS
      });
      res.write(": connected\n\n");
      sessions.subscribe(sessionId, res);
      return;
    }

    if (method === "POST" && action === "approve") {
      assertJsonContentType(req);
      const input = parseDecisionBody(await readBody(req));
      const session = sessions.get(sessionId);
      sessions.approve(session, input.rationale);
      json(res, 200, { session: sessions.serialize(session) });
      return;
    }

    if (method === "POST" && action === "reject") {
      assertJsonContentType(req);
      const input = parseDecisionBody(await readBody(req));
      const session = sessions.get(sessionId);
      sessions.reject(session, input.rationale);
      json(res, 200, { session: sessions.serialize(session) });
      return;
    }

    if (method === "POST" && action === "run") {
      assertJsonContentType(req);
      parseEmptyBody(await readBody(req));
      const session = sessions.get(sessionId);
      sessions.run(session);
      json(res, 202, { accepted: true, sessionId: session.id });
      return;
    }
  }

  // ---- Static frontend (same origin) ----
  if (method === "GET" && !path.startsWith("/api/")) {
    await serveStatic(res, path);
    return;
  }

  throw new ApiError(404, "not_found", "Not found.");
}

export interface ServerOptions {
  /**
   * R-04: trust X-Forwarded-For for client identity. Enable ONLY when the
   * demo runs behind a reverse proxy that sets/overwrites the header —
   * otherwise clients could spoof their IP and bypass the per-IP cap.
   * Env: TRUST_PROXY=true.
   */
  trustProxy?: boolean;
  /** Phase A: override for tests — defaults to the tmpdir-rooted manager. */
  workspaces?: WorkspaceManager;
}

export function createDemoServer(
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
  options: ServerOptions = {}
): { server: Server; sessions: DemoSessionService } {
  const sessions = new DemoSessionService(
    config,
    options.workspaces ?? new WorkspaceManager()
  );
  const trustProxy =
    options.trustProxy ?? process.env.TRUST_PROXY === "true";

  const server = createServer((req, res) => {
    route(req, res, sessions, trustProxy).catch(error => {
      const apiError = toApiError(error);
      if (apiError.status >= 500) {
        console.error(
          `[demo] ${req.method} ${req.url} →`,
          error instanceof Error ? error.message : error
        );
      }
      if (!res.headersSent) {
        json(res, apiError.status, errorBody(apiError.code, apiError.message));
      } else {
        res.end();
      }
    });
  });

  return { server, sessions };
}

/** Starts the server; used both by the npm script and by tests (port 0). */
export function startDemoServer(
  port: number,
  config?: SessionConfig,
  options?: ServerOptions
): Promise<{ server: Server; url: string; sessions: DemoSessionService }> {
  const { server, sessions } = createDemoServer(config, options);
  return new Promise(resolve => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        sessions,
        url: `http://localhost:${actualPort}`
      });
    });
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === normalize(process.argv[1]);

if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  startDemoServer(port).then(({ url }) => {
    console.log(`\nAI Orchestrator — Interactive Web Demo`);
    console.log(`Experimental MVP — mock agents, no real AI providers.`);
    console.log(`Demo sessions are ephemeral: they expire after ` +
      `${DEFAULT_SESSION_CONFIG.ttlMs / 60000} minutes of inactivity ` +
      `and are lost on restart.\n`);
    console.log(`Open ${url}\n`);
  });
}
