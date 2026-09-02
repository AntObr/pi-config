import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BrowserManager, browserTools, createBrowserTools } from "../src/index.ts";
import { makeProcessFakeBrowser } from "./support/fake-browser.ts";

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

function toolNamed(name: string, tools: ReturnType<typeof createBrowserTools>) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeNamedTool(tools: ReturnType<typeof createBrowserTools>, name: string, params: Record<string, unknown>) {
  return toolNamed(name, tools).execute("test-call", params, undefined, undefined, { cwd: process.cwd() } as never);
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

function resultDetails(response: unknown): Record<string, unknown> {
  assert.ok(response && typeof response === "object");
  const detailsValue = (response as { details?: unknown }).details;
  assert.ok(detailsValue && typeof detailsValue === "object");
  return detailsValue as Record<string, unknown>;
}

async function withCookieServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const owner = url.pathname.match(/^\/set\/(.+)$/)?.[1];
    if (owner) {
      response.setHeader("set-cookie", `owner=${owner}; Path=/; SameSite=Lax`);
      response.end(`<!doctype html><title>set ${owner}</title><main>set ${owner}</main>`);
      return;
    }

    response.end(`<!doctype html><title>echo</title><main>cookie ${request.headers.cookie ?? "none"}</main>`);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => (server as Server).close((error) => (error ? reject(error) : resolve())));
  }
}

class BrowserProcess {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdout = "";
  private stderr = "";
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(options: { runtime?: "fake" | "default" } = {}) {
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), "support", "browser-process-worker.ts");
    this.child = spawn(process.execPath, ["--import", "tsx", workerPath], {
      cwd: process.cwd(),
      env: { ...process.env, PI_BROWSER_PROCESS_RUNTIME: options.runtime ?? "fake" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.readStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code, signal) => {
      const error = new Error(`Browser process exited with code ${code} signal ${signal}. ${this.stderr}`.trim());
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  async tool(name: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return resultDetails(await this.send({ tool: name, params }));
  }

  async closeAll(): Promise<Record<string, unknown>> {
    const result = await this.send({ action: "closeAll" });
    assert.ok(result && typeof result === "object");
    return result as Record<string, unknown>;
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    try {
      await this.send({ action: "exit" });
    } finally {
      this.child.stdin.end();
    }
  }

  private send(command: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const line = JSON.stringify({ id, ...command });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${line}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private readStdout(chunk: string): void {
    this.stdout += chunk;
    while (this.stdout.includes("\n")) {
      const index = this.stdout.indexOf("\n");
      const line = this.stdout.slice(0, index);
      this.stdout = this.stdout.slice(index + 1);
      if (!line) continue;
      const response = JSON.parse(line) as WorkerResponse;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error ?? "Browser process command failed."));
    }
  }
}

test("a parent process and a subagent process can both use the default session independently", async () => {
  const child = new BrowserProcess();
  const parentManager = new BrowserManager(makeProcessFakeBrowser().browserType as never);
  const parentTools = createBrowserTools({ manager: parentManager });

  try {
    await executeNamedTool(parentTools, "browser_navigate", { url: "https://example.test/parent" });
    await child.tool("browser_navigate", { url: "https://example.test/subagent" });

    const parent = details(await executeNamedTool(parentTools, "browser_inspect", {}));
    const subagent = await child.tool("browser_inspect");

    assert.equal(parent.session, "default");
    assert.equal(parent.url, "https://example.test/parent");
    assert.deepEqual(parent.elements, [{ id: "e1", tag: "a", text: "Link for parent", selectors: ["#parent"] }]);
    assert.equal(subagent.session, "default");
    assert.equal(subagent.url, "https://example.test/subagent");
    assert.deepEqual(subagent.elements, [{ id: "e1", tag: "a", text: "Link for subagent", selectors: ["#subagent"] }]);

    assert.equal(details(await executeNamedTool(parentTools, "browser_interact", { action: "click", elementId: "e1" })).selector, "#parent");
    assert.equal((await child.tool("browser_interact", { action: "click", elementId: "e1" })).selector, "#subagent");

    await child.tool("browser_close");

    assert.equal(details(await executeNamedTool(parentTools, "browser_inspect", {})).url, "https://example.test/parent");
    assert.equal((await child.tool("browser_inspect")).status, "inspection_unavailable");
  } finally {
    await parentManager.closeAll();
    await child.stop();
  }
});

test("sibling subagent processes can browse and clean up without sharing named sessions", async () => {
  const first = new BrowserProcess();
  const second = new BrowserProcess();

  try {
    await first.tool("browser_navigate", { url: "https://example.test/first" });
    await second.tool("browser_navigate", { url: "https://example.test/second" });

    assert.equal((await first.tool("browser_inspect")).url, "https://example.test/first");
    assert.equal((await second.tool("browser_inspect")).url, "https://example.test/second");

    const closed = await first.closeAll();
    assert.deepEqual(closed.closed, [{ status: "closed", session: "default", existed: true }]);
    assert.equal((await first.tool("browser_inspect")).status, "inspection_unavailable");
    assert.equal((await second.tool("browser_inspect")).url, "https://example.test/second");
  } finally {
    await first.stop();
    await second.stop();
  }
});

test("default extension managers keep cookies separate across processes", async (t) => {
  const child = new BrowserProcess({ runtime: "default" });

  await withCookieServer(async (baseUrl) => {
    try {
      const parentSet = details(await executeNamedTool(browserTools, "browser_navigate", { url: `${baseUrl}/set/parent` }));
      if (parentSet.status === "browser_install_required") {
        t.skip("Playwright Chromium is not installed.");
        return;
      }
      assert.equal(parentSet.status, "loaded");

      const childSet = await child.tool("browser_navigate", { url: `${baseUrl}/set/subagent` });
      if (childSet.status === "browser_install_required") {
        t.skip("Playwright Chromium is not installed.");
        return;
      }
      assert.equal(childSet.status, "loaded");

      await executeNamedTool(browserTools, "browser_navigate", { url: `${baseUrl}/echo` });
      await child.tool("browser_navigate", { url: `${baseUrl}/echo` });

      const parentEcho = details(await executeNamedTool(browserTools, "browser_inspect", {}));
      const childEcho = await child.tool("browser_inspect");
      assert.match(String(parentEcho.text), /cookie owner=parent/);
      assert.match(String(childEcho.text), /cookie owner=subagent/);

      await child.tool("browser_close");
      await executeNamedTool(browserTools, "browser_navigate", { url: `${baseUrl}/echo` });
      assert.match(String(details(await executeNamedTool(browserTools, "browser_inspect", {})).text), /cookie owner=parent/);
    } finally {
      await executeNamedTool(browserTools, "browser_close", {});
      await child.stop();
    }
  });
});
