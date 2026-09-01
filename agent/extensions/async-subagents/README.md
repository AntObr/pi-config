# async-subagents

`async-subagents` adds read-only background subagents to pi. A subagent is a separate pi process launched with its own prompt, tools, working directory, timeout, and job record. The parent session can keep working while the child runs.

## Tools

- `subagent_spawn` starts a background job and returns its id and alias.
- `subagent_status` lists jobs and can filter by job id, status, root id, parent id, or uncollected results.
- `subagent_collect` reads a completed result and marks it collected. With `wait=true`, it blocks until the job finishes or times out.
- `subagent_cancel` cancels a queued or running job.

Mutation tools are disabled in this version. Requests that enable `allowMutation`, `edit`, or `write` are rejected. `worktree` and `temp-copy` workspaces are also reserved for later use.

## Commands

- `/subagents` shows current jobs.
- `/subagent-spawn <task>` starts a generic read-only subagent.
- `/subagent-collect <id>` shows a completed result.
- `/subagent-cancel <id>` cancels a job.

## Job data

The extension stores job metadata, logs, and results under the subagent registry directory. By default this is:

```text
~/.pi/subagents/runs/<session-id>/
```

Set `PI_SUBAGENT_REGISTRY_DIR` to override the registry location. Each job has a JSON metadata file, an optional JSONL event log, and a result JSON file.

## Profiles

Profiles are Markdown files with frontmatter. They can set a name, description, tools, model, timeout, maximum depth, workspace, and system prompt body.

Profile lookup uses these directories, depending on configuration and project trust:

```text
~/.pi/subagents/profiles/
~/.pi/agents/
<project>/.pi/subagents/profiles/
<project>/.pi/agents/
```

## Configuration

Configuration is read from:

```text
~/.pi/subagents/config.json
<project>/.pi/subagents/config.json
```

Project configuration is used only for trusted projects. Supported settings include concurrency limits, depth limits, per-parent limits, default timeout, shutdown behavior, log storage, log redaction, profile scope, and an optional cost limit.

## UI

When the TUI is active, the extension shows a status line with running and unread counts and a widget with recent jobs. Session entries render subagent status, task details, model, tools, working directory, and result summary when expanded.
