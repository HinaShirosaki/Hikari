---
name: command-line
description: Use when local shell commands are the fastest way to inspect or operate on the project, such as listing files, checking git state, running tests, or invoking local CLIs. This skill works with the `command-line` tool.
user-invocable: true
command-dispatch: tool
command-tool: command-line
command-arg-mode: raw
metadata: {"openclaw":{"requires":{"anyBins":["zsh","bash","sh"]}}}
---

# Command Line

Use the `command-line` tool when a shell command is the most direct path.

- Prefer focused commands over long shell pipelines.
- Start with read-only inspection commands when you are gathering context.
- Use the current workspace unless the user explicitly asks for another directory.
- Treat non-zero exit codes as useful feedback and report the important stderr lines back to the user.
