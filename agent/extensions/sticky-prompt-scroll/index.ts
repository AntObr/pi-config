import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsManager, Theme } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "sticky-prompt-scroll";
const DISABLE_ENV = "PI_STICKY_PROMPT_SCROLL";
const SCROLLBAR_ENV = "PI_STICKY_PROMPT_SCROLLBAR";
const SCROLLBAR_COLOR_ENV = "PI_STICKY_PROMPT_SCROLLBAR_COLOR";
const SETTINGS_PATCH_STATE = Symbol.for("pi.extension.sticky-prompt-scroll.settings-patch-state");
const THEME_PATCH_STATE = Symbol.for("pi.extension.sticky-prompt-scroll.theme-patch-state");

type TuiMode = "regular" | "fullscreen";
type ScrollbarMode = "hidden" | "auto" | "always";
type ThemeBg = Parameters<Theme["bg"]>[0];

type SettingsManagerPatchState = {
	originalGetTuiMode: () => TuiMode;
	originalGetFullscreenScrollbar: () => ScrollbarMode;
};

type ThemePatchState = {
	originalBg: Theme["bg"];
};

function shouldForceFullscreen(): boolean {
	const value = process.env[DISABLE_ENV]?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

function getScrollbarMode(): ScrollbarMode {
	const value = process.env[SCROLLBAR_ENV]?.trim().toLowerCase();
	if (value === "hidden" || value === "auto" || value === "always") return value;
	return "always";
}

function getScrollbarColor(): string {
	return process.env[SCROLLBAR_COLOR_ENV]?.trim() || "#5f87ff";
}

function scrollbarBgAnsi(color: string): string | undefined {
	const index = Number(color);
	if (Number.isInteger(index) && index >= 0 && index <= 255) return `\x1b[48;5;${index}m`;

	const match = /^#?([0-9a-f]{6})$/i.exec(color);
	if (!match) return undefined;
	const hex = match[1]!;
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * Keep pi's prompt/editor visible while reading earlier transcript content, and
 * show a browser-like scrollbar for the transcript viewport.
 *
 * Pi's built-in fullscreen TUI already has the sticky-prompt behavior we want:
 * the transcript scrolls in its own viewport and the editor/status/footer stay
 * docked at the bottom. Regular mode uses terminal-owned scrollback, where a
 * redraw while typing can jump the terminal back to the bottom.
 *
 * Extensions are loaded before InteractiveMode is constructed, so patching the
 * settings getters here makes fullscreen + scrollbar the default for this
 * process without editing the user's settings file. A CLI `--tui-mode regular`
 * still wins for the TUI mode.
 */
function patchTuiDefaults() {
	const proto = SettingsManager.prototype as unknown as {
		getTuiMode: () => TuiMode;
		getFullscreenScrollbar: () => ScrollbarMode;
	};
	const patchableProto = proto as typeof proto & Record<symbol, SettingsManagerPatchState | undefined>;

	if (!patchableProto[SETTINGS_PATCH_STATE]) {
		patchableProto[SETTINGS_PATCH_STATE] = {
			originalGetTuiMode: proto.getTuiMode,
			originalGetFullscreenScrollbar: proto.getFullscreenScrollbar,
		};
	}

	const patchState = patchableProto[SETTINGS_PATCH_STATE]!;
	proto.getTuiMode = function patchedGetTuiMode() {
		if (!shouldForceFullscreen()) return patchState.originalGetTuiMode.call(this);
		return "fullscreen";
	};
	proto.getFullscreenScrollbar = function patchedGetFullscreenScrollbar() {
		if (!shouldForceFullscreen()) return patchState.originalGetFullscreenScrollbar.call(this);
		return getScrollbarMode();
	};
}

function patchScrollbarStyle() {
	const proto = Theme.prototype;
	const patchableProto = proto as typeof proto & Record<symbol, ThemePatchState | undefined>;

	if (!patchableProto[THEME_PATCH_STATE]) {
		patchableProto[THEME_PATCH_STATE] = { originalBg: proto.bg };
	}

	const patchState = patchableProto[THEME_PATCH_STATE]!;
	proto.bg = function patchedThemeBg(color: ThemeBg, text: string) {
		if (shouldForceFullscreen() && color === "scrollbarThumb") {
			const ansi = scrollbarBgAnsi(getScrollbarColor());
			if (ansi) return `${ansi}${text}\x1b[49m`;
		}
		return patchState.originalBg.call(this, color, text);
	};
}

export default function stickyPromptScroll(pi: ExtensionAPI) {
	patchTuiDefaults();
	patchScrollbarStyle();

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI) return;

		if (!shouldForceFullscreen()) {
			ctx.ui.setStatus(EXTENSION_ID, undefined);
			return;
		}

		const scrollbarMode = getScrollbarMode();
		const scrollbarStatus = scrollbarMode === "hidden" ? "" : ` + scrollbar:${scrollbarMode}`;
		ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("accent", `sticky prompt${scrollbarStatus}`));

		// If the user explicitly started with `--tui-mode regular`, the patch is
		// intentionally bypassed by pi's CLI option. Tell them why the behavior is
		// unavailable in this run.
		if (ctx.ui.mode === "regular") {
			ctx.ui.notify(
				"Sticky prompt scroll needs fullscreen TUI. Restart without `--tui-mode regular`, or set TUI mode to fullscreen in /settings.",
				"warning",
			);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus(EXTENSION_ID, undefined);
	});

	pi.registerCommand("sticky-prompt-scroll", {
		description: "Show sticky-prompt-scroll status and usage",
		handler: async (_args, ctx) => {
			const enabled = shouldForceFullscreen();
			const scrollbarMode = getScrollbarMode();
			ctx.ui.notify(
				enabled
					? `sticky-prompt-scroll is enabled. Scroll the transcript with wheel/PageUp/PageDown; the prompt stays visible and typing will not jump the transcript to the bottom. Scrollbar: ${scrollbarMode}; color: ${getScrollbarColor()} (set ${SCROLLBAR_ENV}=auto|always|hidden or ${SCROLLBAR_COLOR_ENV}=#rrggbb|0-255, then /reload, to change it).`
					: `sticky-prompt-scroll is disabled by ${DISABLE_ENV}. Unset it or set it to 1, then /reload.`,
				enabled ? "info" : "warning",
			);
		},
	});
}
