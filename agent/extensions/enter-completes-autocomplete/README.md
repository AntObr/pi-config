# enter-completes-autocomplete

`enter-completes-autocomplete` makes Enter accept the active autocomplete item in the TUI editor.

Pi already treats Enter like Tab for most completions. Slash-command completion is the awkward case: Enter accepts the selected item and then submits. This extension intercepts Enter while autocomplete is open and sends the editor a Tab input instead.
