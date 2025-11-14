# Guide to using the `task_tracker` MCP server

- All task files for this project must live under the project root’s `./tasks` directory.
- Each high-level goal (i.e. a PRD) should have its own task file, e.g. `./tasks/feature_x_{date}.md`.
- Use the project root as the `workspace`
- Use `./tasks` for the `source_path`
- Avoid calling `tasks_setup` repeatedly on the same file; call it once per file and reuse its `source_id`.

## Use these tools when:

- Multi-step work needs to be tracked/organized.

Do **not** use this skill for:

- One-off clarifications or tiny ephemeral notes.
- Large freeform documents (use normal file editing tools instead).
