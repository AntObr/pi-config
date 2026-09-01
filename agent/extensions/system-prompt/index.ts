import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "system-prompt";

interface SystemPromptEntryData {
	prompt: string;
	model?: string;
	cwd: string;
	createdAt: number;
}

function maxBacktickRun(text: string): number {
	let max = 0;
	for (const match of text.matchAll(/`+/g)) {
		max = Math.max(max, match[0].length);
	}
	return max;
}

function fencedCodeBlock(text: string): string {
	const fence = "`".repeat(Math.max(3, maxBacktickRun(text) + 1));
	return `${fence}text\n${text}\n${fence}`;
}

export default function systemPromptExtension(pi: ExtensionAPI) {
	pi.registerEntryRenderer<SystemPromptEntryData>(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;

		const modelLine = data.model ? `Model: ${data.model}\n` : "";
		const content = `${theme.fg("accent", "[system prompt]")} ${theme.fg("dim", new Date(data.createdAt).toLocaleString())}\n${modelLine}CWD: ${data.cwd}\n\n${fencedCodeBlock(data.prompt)}`;

		return new Text(content, 1, 1, (text: string) => theme.bg("customMessageBg", text));
	});

	pi.registerCommand("system-prompt", {
		description: "Show the constructed system prompt for the current session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const prompt = ctx.getSystemPrompt();
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;

			pi.appendEntry<SystemPromptEntryData>(ENTRY_TYPE, {
				prompt,
				model,
				cwd: ctx.cwd,
				createdAt: Date.now(),
			});
		},
	});
}
