/**
 * Minimal ambient declarations for the Node APIs used by the web demo
 * layer. The project is intentionally zero-dependency — @types/node is
 * not installed — so only the exact surface we consume is declared here.
 * If @types/node is ever added as a devDependency, delete this file.
 */
declare module "node:http" {
  export interface IncomingMessage extends AsyncIterable<Uint8Array> {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
  }

  export interface ServerResponse {
    headersSent: boolean;
    writableEnded: boolean;
    destroyed: boolean;
    writeHead(status: number, headers?: Record<string, string>): void;
    write(chunk: string | Uint8Array): boolean;
    end(data?: string | Uint8Array): void;
    on(event: "close", listener: () => void): void;
  }

  export interface Server {
    listen(port: number, callback?: () => void): void;
    close(callback?: () => void): void;
    address(): { port: number } | string | null;
  }

  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void
  ): Server;
}

declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function normalize(path: string): string;
  export function extname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
};
