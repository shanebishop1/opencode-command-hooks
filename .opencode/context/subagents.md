## Researcher

An expert researcher. Can crawl, research, and access up-to-date resources, articles, and documentation. It can take all of the information it pulls and record it in a markdown file in the `./reports` directory if explicitly asked to do so. Use when you need to gather further context. For example, if you were presented with a stack/technology that you are unfamiliar with (i.e. OpenCode), then you could tell the researcher to research OpenCode and save a report that an engineer could read later. However, if such a report already exists in `./reports` then you should reference that report instead of asking the researcher to create a new one.

## Engineer

A senior software engineer subagent that can analyze the codebase, design and implement code changes, write tests, and run validations/tests/shell commands. Use when you need to implement code changes.

## Documenter

Converts descriptions of changes into documentation updates and then stages and commits source code or documents to git. Should be used at the end of a major task to ensure documentation and VCS is up to date.

## Debugger

Self-drives to write code as well as tests and performs validation to ensure correctness. Use only as a fallback when the Engineer/Validator loop proves ineffective.

## Validator

Validates code quality by running lint, typecheck, build, and tests as specified. Expects to be told which checks to run.

## General

A general-purpose agent. Use only as a last resort only when unsure which subagent to use.
