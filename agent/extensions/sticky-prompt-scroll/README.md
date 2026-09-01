# sticky-prompt-scroll

`sticky-prompt-scroll` starts pi in fullscreen TUI mode so the transcript scrolls separately from the prompt. The prompt, status, and footer stay docked at the bottom while you read earlier output.

It also styles the fullscreen transcript scrollbar.

## Configuration

- `PI_STICKY_PROMPT_SCROLL=0|false|off|no` disables the extension.
- `PI_STICKY_PROMPT_SCROLLBAR=auto|always|hidden` sets the scrollbar mode. The default is `always`.
- `PI_STICKY_PROMPT_SCROLLBAR_COLOR=#rrggbb|0-255` sets the scrollbar thumb color. The default is `#5f87ff`.

Run `/sticky-prompt-scroll` to show the current status.
