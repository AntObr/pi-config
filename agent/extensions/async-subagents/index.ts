import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum, uuidv7 } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	parseFrontmatter,
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type WorkspaceMode = "shared" | "worktree" | "temp-copy";
type ProfileSource = "user" | "project";

interface Config {
	maxDepth: number;
	maxConcurrent: number;
	maxChildrenPerParent: number;
	maxJobsPerTree: number;
	defaultTimeoutMs: number;
	killOnShutdown: boolean;
	storeFullLogs: boolean;
	redactLogs: boolean;
	redactionPatterns: string[];
	selfExtensionPath?: string;
	profileScope: "user" | "project" | "both";
	defaultCostLimitUsd?: number;
}

interface Profile {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	timeoutMs?: number;
	maxDepth?: number;
	workspace?: WorkspaceMode;
	systemPrompt: string;
	source: ProfileSource;
	filePath: string;
}

interface JobRecord {
	id: string;
	alias: string;
	rootId: string;
	parentId?: string;
	depth: number;
	status: JobStatus;
	title: string;
	task: string;
	profile?: string;
	profileSource?: ProfileSource;
	model?: string;
	tools?: string[];
	cwd: string;
	workspace: WorkspaceMode;
	allowMutation: boolean;
	createdAt: number;
	startedAt?: number;
	finishedAt?: number;
	collectedAt?: number;
	cancelledAt?: number;
	appliedAt?: number;
	timeoutMs: number;
	pid?: number;
	exitCode?: number | null;
	costUsd?: number;
	usage?: UsageStats;
	summary?: string;
	error?: string;
	logPath: string;
	resultPath: string;
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	contextTokens?: number;
}

type RunningJob = { proc: ChildProcessWithoutNullStreams; timeout?: NodeJS.Timeout; record: JobRecord };

type ProfileFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	timeoutMs?: unknown;
	maxDepth?: unknown;
	workspace?: unknown;
};

const EXTENSION_ID = "async-subagents";
const ENTRY_TYPE = "subagent-job";
const ENV_REGISTRY_DIR = "PI_SUBAGENT_REGISTRY_DIR";
const ENV_ROOT_ID = "PI_SUBAGENT_ROOT_ID";
const ENV_PARENT_ID = "PI_SUBAGENT_PARENT_ID";
const ENV_DEPTH = "PI_SUBAGENT_DEPTH";

const DEFAULT_CONFIG: Config = {
	maxDepth: 2,
	maxConcurrent: 3,
	maxChildrenPerParent: 2,
	maxJobsPerTree: 12,
	defaultTimeoutMs: 10 * 60 * 1000,
	killOnShutdown: true,
	storeFullLogs: true,
	redactLogs: false,
	redactionPatterns: [],
	profileScope: "both",
};

const SpawnParams = Type.Object({
	task: Type.String({ description: "Goal/task for the subagent." }),
	title: Type.Optional(Type.String({ description: "Short display title. Defaults to a task preview." })),
	profile: Type.Optional(Type.String({ description: "Named subagent profile to use." })),
	systemPrompt: Type.Optional(Type.String({ description: "System prompt for a generic subagent or extra profile guidance." })),
	context: Type.Optional(Type.String({ description: "Task-specific context selected by the main agent." })),
	expectedOutput: Type.Optional(Type.String({ description: "Expected output contract. Defaults to a structured summary." })),
	returnFormat: Type.Optional(Type.String({ description: "Override the default final summary format." })),
	model: Type.Optional(Type.String({ description: "Model override, e.g. anthropic/claude-sonnet-4-5." })),
	tools: Type.Optional(Type.Array(Type.String(), { description: "Tool names for this subagent. Defaults to profile tools or read-only tools." })),
	cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to current cwd." })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, description: "Timeout in milliseconds." })),
	allowMutation: Type.Optional(Type.Boolean({ description: "Allow mutation-capable tools. MVP rejects true." })),
	workspace: Type.Optional(StringEnum(["shared", "worktree", "temp-copy"] as const)),
	depthLimit: Type.Optional(Type.Integer({ minimum: 0, description: "Maximum descendant depth for this subagent tree." })),
	costLimitUsd: Type.Optional(Type.Number({ minimum: 0, description: "Soft cost budget for the subagent tree." })),
	saveSession: Type.Optional(Type.Boolean({ description: "Save a normal pi session for this subagent. Default false." })),
});

type SpawnInput = Static<typeof SpawnParams>;

const StatusParams = Type.Object({
	jobId: Type.Optional(Type.String({ description: "Job id/alias to inspect." })),
	status: Type.Optional(StringEnum(["queued", "running", "completed", "failed", "cancelled"] as const)),
	uncollectedOnly: Type.Optional(Type.Boolean()),
	rootId: Type.Optional(Type.String()),
	parentId: Type.Optional(Type.String()),
	includeTree: Type.Optional(Type.Boolean({ default: true })),
});

const CollectParams = Type.Object({
	jobId: Type.String({ description: "Job id or alias to collect." }),
	wait: Type.Optional(Type.Boolean({ description: "Wait until completion instead of returning not-ready." })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
});

const CancelParams = Type.Object({
	jobId: Type.String({ description: "Job id or alias to cancel." }),
	reason: Type.Optional(Type.String()),
});

function now() { return Date.now(); }
function shortAlias(id: string): string { return `sa-${id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase()}`; }
function preview(text: string, max = 80): string { const one = text.replace(/\s+/g, " ").trim(); return one.length > max ? `${one.slice(0, max - 1)}…` : one; }
function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
	return tools.length ? tools : undefined;
}
function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; } }
function writeJson(file: string, value: unknown) { ensureDir(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); }
function mergeConfig(base: Config, override: Partial<Config>): Config { return { ...base, ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)) }; }
function loadConfig(cwd: string, projectTrusted: boolean): Config {
	let config = mergeConfig(DEFAULT_CONFIG, readJson<Partial<Config>>(path.join(getAgentDir(), "subagents", "config.json"), {}));
	if (projectTrusted) config = mergeConfig(config, readJson<Partial<Config>>(path.join(cwd, CONFIG_DIR_NAME, "subagents", "config.json"), {}));
	return config;
}
function registryDir(cwd: string, sessionId: string): string {
	return process.env[ENV_REGISTRY_DIR] ?? path.join(getAgentDir(), "subagents", "runs", sessionId || path.basename(cwd));
}
function jobPath(dir: string, id: string) { return path.join(dir, "jobs", `${id}.json`); }
function logsDir(dir: string) { return path.join(dir, "logs"); }
function resultsDir(dir: string) { return path.join(dir, "results"); }
function saveJob(dir: string, job: JobRecord) { writeJson(jobPath(dir, job.id), job); }
function loadJobs(dir: string): JobRecord[] {
	const jobsPath = path.join(dir, "jobs");
	try { return fs.readdirSync(jobsPath).filter((f) => f.endsWith(".json")).map((f) => readJson<JobRecord | null>(path.join(jobsPath, f), null)).filter((j): j is JobRecord => Boolean(j)); } catch { return []; }
}
function findJob(dir: string, idOrAlias: string): JobRecord | undefined { return loadJobs(dir).find((j) => j.id === idOrAlias || j.alias === idOrAlias || j.id.startsWith(idOrAlias)); }
function elapsed(job: JobRecord): string { const end = job.finishedAt ?? now(); const start = job.startedAt ?? job.createdAt; const sec = Math.max(0, Math.round((end - start) / 1000)); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`; }
function activeCount(jobs: JobRecord[]) { return jobs.filter((j) => j.status === "queued" || j.status === "running").length; }
function childrenOf(jobs: JobRecord[], parentId?: string) { return jobs.filter((j) => j.parentId === parentId); }
function sameRootCount(jobs: JobRecord[], rootId: string) { return jobs.filter((j) => j.rootId === rootId).length; }
function redactor(config: Config) {
	const regexes = config.redactLogs ? config.redactionPatterns.map((p) => { try { return new RegExp(p, "g"); } catch { return undefined; } }).filter((r): r is RegExp => Boolean(r)) : [];
	return (text: string) => regexes.reduce((acc, re) => acc.replace(re, "[REDACTED]"), text);
}
function appendLog(job: JobRecord, config: Config, event: unknown) {
	if (!config.storeFullLogs) return;
	ensureDir(path.dirname(job.logPath));
	const redact = redactor(config);
	fs.appendFileSync(job.logPath, `${redact(JSON.stringify(event))}\n`, { encoding: "utf8", mode: 0o600 });
}
function extractTextContent(content: any): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n");
}
function defaultSummaryContract() {
	return [
		"Return a concise structured summary when complete.",
		"Use this format unless the task's returnFormat says otherwise:",
		"## Summary",
		"## Findings",
		"## Evidence",
		"## Files read/changed",
		"## Confidence",
		"## Open questions",
	].join("\n");
}
function genericFallbackPrompt() {
	return [
		"You are a focused pi subagent working in an isolated context.",
		"Complete only the delegated task. Prefer investigation and evidence over broad implementation.",
		"Do not ask the user questions. If blocked, document the blocker and best next step.",
		"If subagent tools are available and further delegation is clearly useful, you may spawn child subagents within the provided depth/budget limits.",
	].join("\n");
}
function buildPrompt(profile: Profile | undefined, input: SpawnInput, depth: number, rootId: string, parentId: string) {
	const parts = [
		profile?.systemPrompt || input.systemPrompt || genericFallbackPrompt(),
		"",
		`Subagent metadata: root=${rootId}, parent=${parentId}, depth=${depth}.`,
	];
	if (profile && input.systemPrompt) parts.push("\nAdditional dispatch guidance:\n", input.systemPrompt);
	if (input.context) parts.push("\nTask-specific context selected by the parent agent:\n", input.context);
	parts.push("\nDelegated task:\n", input.task);
	parts.push("\nExpected output:\n", input.returnFormat || input.expectedOutput || defaultSummaryContract());
	return parts.join("\n");
}
function profileDirs(cwd: string, trusted: boolean, scope: Config["profileScope"]): Array<{ dir: string; source: ProfileSource }> {
	const dirs: Array<{ dir: string; source: ProfileSource }> = [];
	if (scope !== "project") {
		dirs.push({ dir: path.join(getAgentDir(), "subagents", "profiles"), source: "user" });
		dirs.push({ dir: path.join(getAgentDir(), "agents"), source: "user" });
	}
	if (trusted && scope !== "user") {
		dirs.push({ dir: path.join(cwd, CONFIG_DIR_NAME, "subagents", "profiles"), source: "project" });
		dirs.push({ dir: path.join(cwd, CONFIG_DIR_NAME, "agents"), source: "project" });
	}
	return dirs;
}
function discoverProfiles(cwd: string, trusted: boolean, scope: Config["profileScope"]): Profile[] {
	const map = new Map<string, Profile>();
	for (const { dir, source } of profileDirs(cwd, trusted, scope)) {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
		for (const entry of entries) {
			if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
			const filePath = path.join(dir, entry.name);
			let content = "";
			try { content = fs.readFileSync(filePath, "utf8"); } catch { continue; }
			const { frontmatter, body } = parseFrontmatter<ProfileFrontmatter>(content);
			if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
			map.set(frontmatter.name, {
				name: frontmatter.name,
				description: frontmatter.description,
				tools: parseToolList(frontmatter.tools),
				model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
				timeoutMs: typeof frontmatter.timeoutMs === "number" ? frontmatter.timeoutMs : undefined,
				maxDepth: typeof frontmatter.maxDepth === "number" ? frontmatter.maxDepth : undefined,
				workspace: frontmatter.workspace === "worktree" || frontmatter.workspace === "temp-copy" || frontmatter.workspace === "shared" ? frontmatter.workspace : undefined,
				systemPrompt: body.trim(),
				source,
				filePath,
			});
		}
	}
	return Array.from(map.values());
}
function invocation(args: string[]) {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) return { command: process.execPath, args: [currentScript, ...args] };
	const execName = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(execName) ? { command: "pi", args } : { command: process.execPath, args };
}
function usageZero(): UsageStats { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }; }
function addUsage(usage: UsageStats, msg: any) {
	if (msg?.role !== "assistant") return;
	usage.turns++;
	const u = msg.usage;
	if (!u) return;
	usage.input += u.input || 0;
	usage.output += u.output || 0;
	usage.cacheRead += u.cacheRead || 0;
	usage.cacheWrite += u.cacheWrite || 0;
	usage.cost += u.cost?.total || 0;
	usage.contextTokens = u.totalTokens || usage.contextTokens;
}
function finalTextFromResult(file: string): string { return readJson<{ summary?: string }>(file, {}).summary ?? ""; }
function renderJobLine(job: JobRecord) {
	const cost = job.costUsd ? ` $${job.costUsd.toFixed(4)}` : "";
	const parent = job.parentId ? ` parent:${job.parentId.slice(0, 8)}` : "";
	return `${job.alias} ${job.status} d${job.depth} ${elapsed(job)}${cost}${parent} ${job.profile ? `[${job.profile}] ` : ""}${preview(job.title || job.task, 64)}`;
}
function statusText(jobs: JobRecord[]) {
	if (jobs.length === 0) return "No subagents.";
	return jobs.sort((a, b) => b.createdAt - a.createdAt).map(renderJobLine).join("\n");
}

export default function asyncSubagents(pi: ExtensionAPI) {
	const running = new Map<string, RunningJob>();
	let currentRegistryDir = "";
	let currentConfig: Config = DEFAULT_CONFIG;
	let sessionActive = false;

	function refreshWidget(ctx: any) {
		if (!sessionActive || !ctx.hasUI || !currentRegistryDir) return;
		const jobs = loadJobs(currentRegistryDir).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
		if (jobs.length === 0) {
			ctx.ui.setWidget(EXTENSION_ID, undefined);
			ctx.ui.setStatus(EXTENSION_ID, undefined);
			return;
		}
		const active = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
		const unread = jobs.filter((j) => (j.status === "completed" || j.status === "failed") && !j.collectedAt).length;
		ctx.ui.setStatus(EXTENSION_ID, `subagents ${active} running ${unread} unread`);
		ctx.ui.setWidget(EXTENSION_ID, jobs.map(renderJobLine), { placement: "belowEditor" });
	}

	function updateJob(ctx: any, job: JobRecord) {
		saveJob(currentRegistryDir, job);
		if (sessionActive) {
			pi.appendEntry<JobRecord>(ENTRY_TYPE, job);
			refreshWidget(ctx);
		}
	}

	function fail(job: JobRecord, error: string, ctx: any) {
		job.status = job.status === "cancelled" ? "cancelled" : "failed";
		job.error = error;
		job.finishedAt = job.finishedAt ?? now();
		writeJson(job.resultPath, { summary: error, error });
		updateJob(ctx, job);
	}

	function spawnJob(input: SpawnInput, ctx: any): { ok: true; job: JobRecord } | { ok: false; error: string } {
		currentConfig = loadConfig(ctx.cwd, ctx.isProjectTrusted());
		const jobs = loadJobs(currentRegistryDir);
		const inheritedDepth = Number(process.env[ENV_DEPTH] ?? "0");
		const parentId = process.env[ENV_PARENT_ID];
		const rootFromEnv = process.env[ENV_ROOT_ID];
		const depth = inheritedDepth + 1;
		const depthLimit = input.depthLimit ?? currentConfig.maxDepth;
		if (depth > depthLimit) return { ok: false, error: `Depth limit reached (${depth}/${depthLimit}).` };
		if (activeCount(jobs) >= currentConfig.maxConcurrent) return { ok: false, error: `Concurrency limit reached (${currentConfig.maxConcurrent}). Try subagent_status later.` };
		if (parentId && childrenOf(jobs, parentId).length >= currentConfig.maxChildrenPerParent) return { ok: false, error: `Per-parent child limit reached (${currentConfig.maxChildrenPerParent}).` };
		const id = uuidv7();
		const rootId = rootFromEnv ?? id;
		if (sameRootCount(jobs, rootId) >= currentConfig.maxJobsPerTree) return { ok: false, error: `Max jobs per tree reached (${currentConfig.maxJobsPerTree}).` };
		if (input.allowMutation) return { ok: false, error: "Mutation-capable subagents are not enabled in the MVP. Spawn read-only subagents only." };

		const profiles = discoverProfiles(ctx.cwd, ctx.isProjectTrusted(), currentConfig.profileScope);
		const profile = input.profile ? profiles.find((p) => p.name === input.profile) : undefined;
		if (input.profile && !profile) return { ok: false, error: `Unknown profile '${input.profile}'. Available: ${profiles.map((p) => p.name).join(", ") || "none"}.` };

		const cwd = path.resolve(ctx.cwd, input.cwd ?? ".");
		const tools = input.tools ?? profile?.tools ?? ["read", "grep", "find", "ls"];
		const mutatingTools = new Set(["edit", "write"]);
		if (tools.some((t) => mutatingTools.has(t))) return { ok: false, error: "Tools include mutation-capable edit/write, which is disabled for MVP subagents." };
		const model = input.model ?? profile?.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
		const timeoutMs = input.timeoutMs ?? profile?.timeoutMs ?? currentConfig.defaultTimeoutMs;
		const workspace = input.workspace ?? profile?.workspace ?? "shared";
		if (workspace !== "shared") return { ok: false, error: `Workspace mode '${workspace}' is reserved for future mutation isolation and is not implemented in MVP.` };

		ensureDir(path.join(currentRegistryDir, "jobs"));
		ensureDir(logsDir(currentRegistryDir));
		ensureDir(resultsDir(currentRegistryDir));
		const job: JobRecord = {
			id, alias: shortAlias(id), rootId, parentId, depth, status: "queued",
			title: input.title || preview(input.task, 60), task: input.task,
			profile: profile?.name, profileSource: profile?.source, model, tools, cwd, workspace,
			allowMutation: false, createdAt: now(), timeoutMs,
			logPath: path.join(logsDir(currentRegistryDir), `${id}.jsonl`),
			resultPath: path.join(resultsDir(currentRegistryDir), `${id}.json`),
		};
		updateJob(ctx, job);

		const prompt = buildPrompt(profile, input, depth, rootId, id);
		const args = ["--mode", "json", "-p"];
		if (!input.saveSession) args.push("--no-session");
		if (model) args.push("--model", model);
		if (tools.length > 0) args.push("--tools", tools.join(","));
		if (currentConfig.selfExtensionPath) args.push("-e", currentConfig.selfExtensionPath);
		args.push(prompt);

		const cmd = invocation(args);
		const child = spawn(cmd.command, cmd.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, [ENV_REGISTRY_DIR]: currentRegistryDir, [ENV_ROOT_ID]: rootId, [ENV_PARENT_ID]: id, [ENV_DEPTH]: String(depth) },
		});
		job.status = "running";
		job.startedAt = now();
		job.pid = child.pid;
		updateJob(ctx, job);

		let stdoutBuffer = "";
		let stderr = "";
		let lastAssistantText = "";
		const usage = usageZero();
		const handleEvent = (event: any) => {
			appendLog(job, currentConfig, event);
			if (event.type === "message_end" && event.message) {
				addUsage(usage, event.message);
				if (event.message.role === "assistant") {
					const text = extractTextContent(event.message.content);
					if (text.trim()) lastAssistantText = text;
					if (!job.model && event.message.model) job.model = event.message.model;
				}
			}
		};
		const flushLine = (line: string) => { if (!line.trim()) return; try { handleEvent(JSON.parse(line)); } catch { appendLog(job, currentConfig, { type: "parse_error", line }); } };
		child.stdout.on("data", (data) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() || "";
			for (const line of lines) flushLine(line);
		});
		child.stderr.on("data", (data) => { stderr += data.toString(); appendLog(job, currentConfig, { type: "stderr", text: data.toString() }); });
		child.on("error", (err) => {
			running.delete(job.id);
			fail(job, err.message, ctx);
		});
		child.on("close", (code) => {
			if (stdoutBuffer.trim()) flushLine(stdoutBuffer);
			if (running.get(job.id)?.timeout) clearTimeout(running.get(job.id)?.timeout);
			running.delete(job.id);
			job.exitCode = code;
			job.finishedAt = now();
			job.usage = usage;
			job.costUsd = usage.cost;
			if (job.status === "cancelled") {
				job.summary = "Cancelled.";
			} else if (code === 0 && lastAssistantText.trim()) {
				job.status = "completed";
				job.summary = lastAssistantText.trim();
			} else {
				job.status = "failed";
				job.error = stderr.trim() || `Subagent exited with code ${code}.`;
				job.summary = job.error;
			}
			writeJson(job.resultPath, { summary: job.summary, error: job.error, usage: job.usage, exitCode: code });
			updateJob(ctx, job);
		});
		const timeout = setTimeout(() => {
			const active = running.get(job.id);
			if (!active) return;
			job.status = "cancelled";
			job.cancelledAt = now();
			job.error = `Timed out after ${timeoutMs}ms.`;
			child.kill("SIGTERM");
			setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
			updateJob(ctx, job);
		}, timeoutMs);
		running.set(job.id, { proc: child, timeout, record: job });
		return { ok: true, job };
	}

	function cancelJob(id: string, reason: string | undefined, ctx: any): JobRecord | undefined {
		const job = findJob(currentRegistryDir, id);
		if (!job) return undefined;
		job.status = "cancelled";
		job.cancelledAt = now();
		job.error = reason || "Cancelled.";
		const active = running.get(job.id);
		if (active) {
			if (active.timeout) clearTimeout(active.timeout);
			active.proc.kill("SIGTERM");
			setTimeout(() => { if (!active.proc.killed) active.proc.kill("SIGKILL"); }, 5000);
			running.delete(job.id);
		}
		updateJob(ctx, job);
		return job;
	}

	async function waitForJob(id: string, timeoutMs: number): Promise<JobRecord | undefined> {
		const started = now();
		while (now() - started < timeoutMs) {
			const job = findJob(currentRegistryDir, id);
			if (!job) return undefined;
			if (!["queued", "running"].includes(job.status)) return job;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return findJob(currentRegistryDir, id);
	}

	pi.on("session_start", (_event, ctx) => {
		sessionActive = true;
		currentRegistryDir = registryDir(ctx.cwd, ctx.sessionManager.getSessionId?.() ?? "session");
		currentConfig = loadConfig(ctx.cwd, ctx.isProjectTrusted());
		ensureDir(path.join(currentRegistryDir, "jobs"));
		refreshWidget(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		sessionActive = false;
		if (currentConfig.killOnShutdown) {
			for (const [id] of running) cancelJob(id, "pi session shut down", ctx);
		}
		if (ctx.hasUI) {
			ctx.ui.setWidget(EXTENSION_ID, undefined);
			ctx.ui.setStatus(EXTENSION_ID, undefined);
		}
	});

	pi.registerEntryRenderer<JobRecord>(ENTRY_TYPE, (entry, { expanded }, theme) => {
		const job = entry.data;
		if (!job) return new Text(theme.fg("muted", "subagent"), 0, 0);
		const icon = job.status === "completed" ? theme.fg("success", "✓") : job.status === "failed" || job.status === "cancelled" ? theme.fg("error", "✗") : theme.fg("warning", "⏳");
		const header = `${icon} ${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", job.alias)} ${theme.fg("muted", `${job.status} d${job.depth} ${elapsed(job)}`)} ${theme.fg("dim", job.profile ? `[${job.profile}]` : "[generic]")}`;
		if (!expanded) return new Text(`${header}\n${theme.fg("dim", preview(job.title || job.task, 100))}`, 0, 0);
		const c = new Container();
		c.addChild(new Text(header, 0, 0));
		c.addChild(new Text(theme.fg("dim", `model: ${job.model ?? "default"} tools: ${(job.tools ?? []).join(",") || "default"} cwd: ${job.cwd}`), 0, 0));
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("muted", "Task:"), 0, 0));
		c.addChild(new Text(job.task, 0, 0));
		if (job.summary) { c.addChild(new Spacer(1)); c.addChild(new Markdown(job.summary, 0, 0)); }
		if (job.error && !job.summary) c.addChild(new Text(theme.fg("error", job.error), 0, 0));
		return c;
	});

	pi.registerTool({
		name: "subagent_spawn",
		label: "Spawn Subagent",
		description: "Start a background pi subagent and return immediately with a job id. Use for independent investigation, research, debugging, or review. MVP is read-only: mutation-capable tools are rejected.",
		promptSnippet: "Spawn background subagents for independent work; collect later with subagent_collect.",
		promptGuidelines: [
			"Use subagent_spawn when independent investigation, code search, debugging, or review can run in parallel with the main task.",
			"Do not wait idly after subagent_spawn; continue useful main-agent work and call subagent_status/subagent_collect before relying on delegated findings or before the final answer.",
			"When the user says to spawn a subagent, call subagent_spawn with a clear task and expected output.",
		],
		parameters: SpawnParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = spawnJob(params, ctx);
			if (!result.ok) return { content: [{ type: "text", text: `Subagent not spawned: ${result.error}` }], details: { error: result.error } };
			return { content: [{ type: "text", text: `Spawned ${result.job.alias} (${result.job.id}) for: ${result.job.title}. Continue work; use subagent_status or subagent_collect when needed.` }], details: result.job };
		},
	});

	pi.registerTool({
		name: "subagent_status",
		label: "Subagent Status",
		description: "List background subagent jobs, with filters for status, root/parent, and uncollected results.",
		promptSnippet: "Check running/completed subagents before depending on delegated work.",
		parameters: StatusParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			refreshWidget(ctx);
			let jobs = loadJobs(currentRegistryDir);
			if (params.jobId) jobs = jobs.filter((j) => j.id === params.jobId || j.alias === params.jobId || j.id.startsWith(params.jobId));
			if (params.status) jobs = jobs.filter((j) => j.status === params.status);
			if (params.uncollectedOnly) jobs = jobs.filter((j) => (j.status === "completed" || j.status === "failed") && !j.collectedAt);
			if (params.rootId) jobs = jobs.filter((j) => j.rootId === params.rootId || j.rootId.startsWith(params.rootId));
			if (params.parentId) jobs = jobs.filter((j) => j.parentId === params.parentId || j.parentId?.startsWith(params.parentId));
			return { content: [{ type: "text", text: statusText(jobs) }], details: { jobs } };
		},
	});

	pi.registerTool({
		name: "subagent_collect",
		label: "Collect Subagent",
		description: "Collect a completed subagent summary. Marks the job as collected but keeps the result available. Default is non-blocking; set wait=true to wait.",
		promptSnippet: "Collect subagent summaries when their work is needed.",
		parameters: CollectParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let job = params.wait ? await waitForJob(params.jobId, params.timeoutMs ?? currentConfig.defaultTimeoutMs) : findJob(currentRegistryDir, params.jobId);
			if (!job) return { content: [{ type: "text", text: `Unknown subagent job: ${params.jobId}` }], details: { error: "not_found" } };
			if (job.status === "queued" || job.status === "running") return { content: [{ type: "text", text: `${job.alias} is ${job.status}; not ready. Use wait=true to block or check later.` }], details: { job } };
			const summary = finalTextFromResult(job.resultPath) || job.summary || job.error || "(no summary)";
			const trunc = truncateHead(summary, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			job.collectedAt = now();
			saveJob(currentRegistryDir, job);
			refreshWidget(ctx);
			const suffix = trunc.truncated ? `\n\n[Summary truncated. Full result: ${job.resultPath}; full log: ${job.logPath}]` : "";
			return { content: [{ type: "text", text: `# ${job.alias} ${job.status}\n\n${trunc.content}${suffix}` }], details: { job, summary } };
		},
	});

	pi.registerTool({
		name: "subagent_cancel",
		label: "Cancel Subagent",
		description: "Cancel a running/queued background subagent by id or alias.",
		parameters: CancelParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const job = cancelJob(params.jobId, params.reason, ctx);
			if (!job) return { content: [{ type: "text", text: `Unknown subagent job: ${params.jobId}` }], details: { error: "not_found" } };
			return { content: [{ type: "text", text: `Cancelled ${job.alias}.` }], details: { job } };
		},
	});

	pi.registerCommand("subagents", { description: "List subagent jobs", handler: async (_args, ctx) => { refreshWidget(ctx); ctx.ui.notify(statusText(loadJobs(currentRegistryDir)), "info"); } });
	pi.registerCommand("subagent-spawn", { description: "Spawn a read-only generic subagent", handler: async (args, ctx) => {
		if (!args.trim()) return ctx.ui.notify("Usage: /subagent-spawn <task>", "warning");
		const result = spawnJob({ task: args, title: preview(args, 60) }, ctx);
		ctx.ui.notify(result.ok ? `Spawned ${result.job.alias}` : result.error, result.ok ? "info" : "error");
	} });
	pi.registerCommand("subagent-collect", { description: "Collect a subagent result", handler: async (args, ctx) => {
		const id = args.trim();
		if (!id) return ctx.ui.notify("Usage: /subagent-collect <id>", "warning");
		const job = findJob(currentRegistryDir, id);
		if (!job) return ctx.ui.notify(`Unknown subagent ${id}`, "error");
		if (job.status === "running" || job.status === "queued") return ctx.ui.notify(`${job.alias} is ${job.status}`, "warning");
		job.collectedAt = now(); saveJob(currentRegistryDir, job); refreshWidget(ctx);
		ctx.ui.notify(`${job.alias}: ${preview(finalTextFromResult(job.resultPath) || job.summary || job.error || "(no summary)", 400)}`, job.status === "completed" ? "info" : "warning");
	} });
	pi.registerCommand("subagent-cancel", { description: "Cancel a subagent", handler: async (args, ctx) => {
		const id = args.trim();
		if (!id) return ctx.ui.notify("Usage: /subagent-cancel <id>", "warning");
		const job = cancelJob(id, "Cancelled by user command", ctx);
		ctx.ui.notify(job ? `Cancelled ${job.alias}` : `Unknown subagent ${id}`, job ? "info" : "error");
	} });
}
