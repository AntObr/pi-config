import { uuidv7 } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	type SelectItem,
} from "@earendil-works/pi-tui";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";

const OPEN_SHORTCUT = "ctrl+alt+s";

type MenuAction =
	| { type: "switch"; path: string }
	| { type: "new" }
	| { type: "rename"; path: string }
	| { type: "delete"; path: string }
	| { type: "redraw" }
	| { type: "cancel" };

type SortMode = "recent" | "created" | "name";

function textContent(content: any): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text")
		.map((block) => block.text ?? "")
		.join(" ");
}

function oneSentence(text: string, fallback = "Untitled session"): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return fallback;
	const firstSentence = cleaned.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? cleaned;
	const summary = truncateToWidth(firstSentence, 180, "…").trim();
	return /[.!?]$/.test(summary) ? summary : `${summary}.`;
}

function conversationTextFromEntries(entries: any[]): string {
	return entries
		.filter((entry) => entry.type === "message" && ["user", "assistant"].includes(entry.message?.role))
		.map((entry) => `${entry.message.role}: ${textContent(entry.message.content)}`)
		.filter((line) => line.trim().length > 12)
		.join("\n\n");
}

function heuristicSessionSummary(text: string, fallback = "Untitled session"): string {
	const cleaned = text
		.replace(/\b(please|can you|could you|let'?s|we need to|i want to)\b/gi, "")
		.replace(/\s+/g, " ")
		.trim();
	return oneSentence(cleaned, fallback);
}

async function modelSessionSummary(ctx: any, conversationText: string): Promise<string | undefined> {
	if (!ctx.model || !conversationText.trim()) return undefined;
	try {
		const response = await ctx.modelRegistry.complete(
			ctx.model,
			{
				messages: [
					{
						role: "user" as const,
						content: [
							{
								type: "text" as const,
								text: [
									"Write a short one-sentence title summary for this coding-agent session.",
									"Summarize the actual work and outcome, not just the first user prompt.",
									"Use at most 12 words. Return only the sentence.",
									"",
									conversationText.slice(-12000),
								].join("\n"),
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{ reasoningEffort: "minimal", cacheRetention: "none", sessionId: uuidv7() },
		);
		const summary = response.content
			.filter((block: any) => block.type === "text")
			.map((block: any) => block.text)
			.join(" ")
			.replace(/^[-"'\s]+|["'\s]+$/g, "");
		return oneSentence(summary);
	} catch {
		return undefined;
	}
}

async function currentSessionSummary(ctx: { sessionManager: { getEntries(): any[] } } & any): Promise<string | undefined> {
	const text = conversationTextFromEntries(ctx.sessionManager.getEntries());
	if (!text.trim()) return undefined;
	return (await modelSessionSummary(ctx, text)) ?? heuristicSessionSummary(text);
}

function formatDate(date: Date): string {
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function sortSessions<T extends { name?: string; firstMessage: string; created: Date; modified: Date }>(
	sessions: T[],
	sortMode: SortMode,
): T[] {
	return [...sessions].sort((a, b) => {
		if (sortMode === "created") return b.created.getTime() - a.created.getTime();
		if (sortMode === "name") {
			const an = (a.name || a.firstMessage || "").toLowerCase();
			const bn = (b.name || b.firstMessage || "").toLowerCase();
			return an.localeCompare(bn);
		}
		return b.modified.getTime() - a.modified.getTime();
	});
}

async function safeListSessions(ctx: any, allProjects: boolean) {
	return allProjects ? SessionManager.listAll() : SessionManager.list(ctx.cwd);
}

function isPromptLikeTitle(session: any): boolean {
	if (!session.name) return true;
	const name = session.name.replace(/\s+/g, " ").trim().toLowerCase();
	const prompt = oneSentence(session.firstMessage || "").replace(/\s+/g, " ").trim().toLowerCase();
	return name === prompt || prompt.startsWith(name) || name.startsWith(prompt.slice(0, Math.min(50, prompt.length)));
}

async function hydrateMissingSummaries(
	ctx: any,
	sessions: any[],
	currentPath: string | undefined,
	setCurrentSessionName: (name: string) => void,
) {
	if (!ctx.model) return;
	const missing = sessions.filter((session) => isPromptLikeTitle(session) && session.allMessagesText?.trim()).slice(0, 8);
	if (missing.length === 0) return;
	ctx.ui.notify(`Summarizing ${missing.length} session${missing.length === 1 ? "" : "s"}...`, "info");
	for (const session of missing) {
		const summary = await modelSessionSummary(ctx, session.allMessagesText);
		if (!summary) continue;
		const sm = SessionManager.open(session.path);
		sm.appendSessionInfo(summary);
		if (session.path === currentPath) setCurrentSessionName(summary);
	}
}

export default function sessionsMenu(pi: ExtensionAPI) {
	async function ensureCurrentSessionTitle(ctx: any) {
		const title = await currentSessionSummary(ctx);
		if (title && (!pi.getSessionName() || pi.getSessionName() === oneSentence(textContent(ctx.sessionManager.getEntries()[0]?.message?.content ?? "")))) {
			pi.setSessionName(title);
		}
	}

	async function openSessions(ctx: any) {
		if (!ctx.hasUI) return;
		await ctx.waitForIdle?.();

		let allProjects = false;
		let sortMode: SortMode = "recent";

		while (true) {
			const currentPath = ctx.sessionManager.getSessionFile();
			let sessions = sortSessions(await safeListSessions(ctx, allProjects), sortMode);
			await hydrateMissingSummaries(ctx, sessions, currentPath, (name) => pi.setSessionName(name));
			sessions = sortSessions(await safeListSessions(ctx, allProjects), sortMode);
			const items: SelectItem[] = sessions.map((session) => {
				const title = oneSentence(session.name || session.firstMessage, basename(session.path));
				const current = session.path === currentPath ? "● " : "  ";
				return {
					value: session.path,
					label: `${current}${title}`,
					description: `${formatDate(session.modified)} • ${session.messageCount} messages${allProjects ? ` • ${session.cwd}` : ""}`,
				};
			});

			let selectedPath = items[0]?.value ?? currentPath;
			const action = await ctx.ui.custom<MenuAction>((tui: any, theme: any, _kb: any, done: (value: MenuAction) => void) => {
				let selectedIndex = Math.max(0, items.findIndex((item) => item.value === selectedPath));
				const maxVisible = Math.min(Math.max(items.length, 1), 14);
				const syncSelectedPath = () => {
					selectedPath = items[selectedIndex]?.value ?? selectedPath;
				};
				syncSelectedPath();

				const renderRows = (width: number) => {
					if (items.length === 0) return [theme.fg("warning", "  No sessions found")];
					const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible));
					const end = Math.min(start + maxVisible, items.length);
					const rows: string[] = [];
					const prefixWidth = 2;
					const gap = "  ";
					// Reserve a responsive metadata column. On wide terminals, titles get most
					// of the panel. As the panel narrows, metadata shrinks but remains visible.
					const metadataWidth = width >= 120 ? 42 : width >= 90 ? 34 : width >= 70 ? 26 : 18;
					const titleWidth = Math.max(12, width - prefixWidth - gap.length - metadataWidth - 2);
					for (let i = start; i < end; i++) {
						const item = items[i]!;
						const selected = i === selectedIndex;
						const prefix = selected ? "→ " : "  ";
						const title = truncateToWidth(item.label, titleWidth, "…");
						const padding = " ".repeat(Math.max(1, titleWidth - visibleWidth(title) + gap.length));
						const metadata = truncateToWidth(item.description ?? "", metadataWidth, "…");
						const line = `${prefix}${title}${theme.fg("muted", padding + metadata)}`;
						rows.push(selected ? theme.fg("accent", line) : line);
					}
					if (start > 0 || end < items.length) rows.push(theme.fg("dim", `  (${selectedIndex + 1}/${items.length})`));
					return rows;
				};

				return {
					render: (width: number) => {
						const outerWidth = Math.max(24, width);
						const innerWidth = Math.max(1, outerWidth - 2);
						const horizontal = theme.fg("accent", "─".repeat(innerWidth));
						const side = (line: string) => {
							const content = truncateToWidth(line, innerWidth, "");
							const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
							return truncateToWidth(`${theme.fg("accent", "│")}${content}${padding}${theme.fg("accent", "│")}`, outerWidth, "");
						};
						const title = new Text(theme.fg("accent", theme.bold("Sessions")), 1, 0);
						const scope = allProjects ? "all projects" : "current project";
						const help = new Text(
							theme.fg("dim", `Enter switch • Ctrl+N new • Ctrl+R rename • Ctrl+D delete • Ctrl+A ${scope} • Ctrl+S sort: ${sortMode} • Esc cancel`),
							1,
							0,
						);
						return [
							`┌${horizontal}┐`,
							...title.render(innerWidth).map(side),
							...renderRows(innerWidth).map(side),
							...help.render(innerWidth).map(side),
							`└${horizontal}┘`,
						].map((line) => truncateToWidth(line, outerWidth, ""));
					},
					handleInput: (data: string) => {
						if (matchesKey(data, Key.ctrl("n"))) done({ type: "new" });
						else if (matchesKey(data, Key.ctrl("r")) && selectedPath) done({ type: "rename", path: selectedPath });
						else if (matchesKey(data, Key.ctrl("d")) && selectedPath) done({ type: "delete", path: selectedPath });
						else if (matchesKey(data, Key.ctrl("a"))) {
							allProjects = !allProjects;
							done({ type: "redraw" });
						} else if (matchesKey(data, Key.ctrl("s"))) {
							sortMode = sortMode === "recent" ? "created" : sortMode === "created" ? "name" : "recent";
							done({ type: "redraw" });
						} else if (matchesKey(data, Key.up)) {
							selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
							syncSelectedPath();
							tui.requestRender();
						} else if (matchesKey(data, Key.down)) {
							selectedIndex = selectedIndex >= items.length - 1 ? 0 : selectedIndex + 1;
							syncSelectedPath();
							tui.requestRender();
						} else if (matchesKey(data, Key.enter) && selectedPath) {
							done({ type: "switch", path: selectedPath });
						} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
							done({ type: "cancel" });
						}
					},
					invalidate: () => {},
				};
			}, { overlay: true, overlayOptions: { width: "80%", minWidth: 72, maxHeight: "85%", anchor: "center" } });

			if (action.type === "cancel") return;
			if (action.type === "redraw") continue;
			if (action.type === "new") {
				await ctx.newSession();
				return;
			}
			if (action.type === "switch") {
				if (action.path !== currentPath) await ctx.switchSession(action.path);
				return;
			}
			if (action.type === "rename") {
				const name = await ctx.ui.input("Rename session", "Single sentence title:");
				if (name?.trim()) {
					const sm = SessionManager.open(action.path);
					sm.appendSessionInfo(oneSentence(name));
					if (action.path === currentPath) pi.setSessionName(oneSentence(name));
				}
				continue;
			}
			if (action.type === "delete") {
				if (action.path === currentPath) {
					ctx.ui.notify("Cannot delete the active session. Switch sessions first.", "warning");
					continue;
				}
				if (await ctx.ui.confirm("Delete session?", action.path)) {
					await unlink(action.path);
					ctx.ui.notify("Session deleted", "info");
				}
				continue;
			}
		}
	}

	pi.on("agent_settled", async (_event, ctx) => ensureCurrentSessionTitle(ctx));
	pi.on("session_start", async (_event, ctx) => ensureCurrentSessionTitle(ctx));

	pi.registerCommand("sessions", {
		description: `Open visual session manager (${OPEN_SHORTCUT})`,
		handler: async (_args, ctx) => openSessions(ctx),
	});

	pi.registerShortcut(OPEN_SHORTCUT, {
		description: "Open visual session manager",
		handler: () => {
			// Session switching APIs are only available to command handlers, so route the
			// shortcut through the /sessions command instead of opening the menu here.
			pi.sendUserMessage("/sessions", { expandPromptTemplates: true });
		},
	});
}
