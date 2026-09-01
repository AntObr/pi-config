# sessions-menu

`sessions-menu` adds a visual session manager to pi.

## Open the menu

- Press `Ctrl+Alt+S`.
- Run `/sessions`.

## Menu actions

- `Enter` switches to the selected session.
- `Ctrl+N` starts a new session.
- `Ctrl+R` renames the selected session.
- `Ctrl+D` deletes the selected session.
- `Ctrl+A` toggles between current-project sessions and all sessions.
- `Ctrl+S` cycles the sort order: recently modified, created date, name.
- `Esc` or `Ctrl+C` closes the menu.

## Displayed data

Each row shows the session title, last modified time, message count, and, in all-projects mode, the session working directory. The active session is marked with `●`.

## Session titles

The extension sets a short title for the current session after session start and after the agent settles. If a model is available, it asks the model for a one-sentence summary. If not, it derives a title from the conversation text.

When the menu opens, it may also summarize up to eight older sessions whose titles still look like their first prompt.

## Deleting sessions

The active session cannot be deleted. Switch to another session first, then delete it from the menu.
