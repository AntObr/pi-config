import {
	CustomEditor,
	type ExtensionAPI,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorOptions, EditorTheme, TUI } from "@earendil-works/pi-tui";

/**
 * Makes Enter accept an active autocomplete suggestion instead of accepting and
 * immediately submitting slash-command completions such as `/skill-name`.
 *
 * Pi's built-in editor already treats Enter like Tab for non-slash completion.
 * The only special case is slash completion: Enter accepts the selected item and
 * falls through to submit. This editor intercepts that case and routes Enter
 * through the Tab action instead.
 */
class EnterCompletesAutocompleteEditor extends CustomEditor {
	private readonly appKeybindings: KeybindingsManager;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, keybindings, options);
		this.appKeybindings = keybindings;
	}

	handleInput(data: string): void {
		if (this.isShowingAutocomplete() && this.appKeybindings.matches(data, "tui.input.submit")) {
			// Route Enter to the same path as a physical Tab key while autocomplete is active.
			// KeybindingsManager#getKeys() returns key ids like "tab", not terminal input bytes;
			// passing "tab" would insert the literal text. The editor expects "\t".
			super.handleInput("\t");
			return;
		}

		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new EnterCompletesAutocompleteEditor(tui, theme, keybindings),
		);
	});
}
