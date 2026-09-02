import readline from "node:readline";

import { BrowserManager, browserTools, createBrowserTools } from "../../src/index.ts";
import { makeProcessFakeBrowser } from "./fake-browser.ts";

type Command = {
  id: number;
  tool?: string;
  params?: Record<string, unknown>;
  action?: "closeAll" | "exit";
};

const runtime = process.env.PI_BROWSER_PROCESS_RUNTIME ?? "fake";
const fakeBrowser = makeProcessFakeBrowser();
const manager = runtime === "fake" ? new BrowserManager(fakeBrowser.browserType as never) : undefined;
const tools = manager ? createBrowserTools({ manager }) : browserTools;

function toolNamed(name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  return tool;
}

async function run(command: Command): Promise<unknown> {
  if (command.action === "exit") {
    if (manager) await manager.closeAll();
    else await toolNamed("browser_close").execute(`worker-${command.id}`, {}, undefined, undefined, { cwd: process.cwd() } as never);
    return { exited: true };
  }

  if (command.action === "closeAll") {
    if (!manager) throw new Error("closeAll is only available for the fake worker runtime.");
    return {
      closed: await manager.closeAll(),
      closedBrowsers: [...fakeBrowser.closedBrowsers],
      closedContexts: [...fakeBrowser.closedContexts],
    };
  }

  if (!command.tool) throw new Error("Command needs a tool or action.");
  const result = await toolNamed(command.tool).execute(
    `worker-${command.id}`,
    command.params ?? {},
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );
  return { details: result.details, text: result.content[0]?.type === "text" ? result.content[0].text : "" };
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  void (async () => {
    const command = JSON.parse(line) as Command;
    try {
      const result = await run(command);
      process.stdout.write(`${JSON.stringify({ id: command.id, ok: true, result })}\n`);
      if (command.action === "exit") process.exit(0);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: command.id, ok: false, error: (error as Error).message })}\n`);
    }
  })();
});
