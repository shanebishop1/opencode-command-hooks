# OpenCode 2 Impact and Migration Report

Status: Implemented beta prototype
Last updated: 2026-07-20
Doc Class: report
Doc Type: research
Report Type: engineering migration
Decision Status: accepted for opt-in beta
Authority: advisory
Canonical Source: `OPENCODE_V2_IMPACT_REPORT.md`
Report topic: OpenCode 2 plugin and client migration

## Summary

OpenCode 2 is currently a beta distributed separately from stable OpenCode 1. The upstream project explicitly warns that its APIs, configuration, data, and plugin APIs may still change. It also explicitly states that OpenCode 1 plugins do not work in OpenCode 2.

`opencode-command-hooks` will not load in OpenCode 2 in its current form. The package exports an OpenCode 1 plugin function that returns a hooks object. OpenCode 2 requires a default plugin descriptor with a unique `id` and `setup` or `effect` function, and hooks are registered imperatively through the new context.

The current OpenCode 2 beta has enough API surface to prototype most core behavior:

- `ctx.tool.hook("execute.before", ...)` and `ctx.tool.hook("execute.after", ...)` can replace the v1 tool hooks.
- `ctx.event.subscribe()` exposes the public event stream for session lifecycle handling.
- `ctx.session.synthetic()` appears to be the intended replacement for injecting context without creating a normal user prompt.
- Existing v1-shaped config and agent Markdown locations are intended to be translated in memory.

However, a production migration should not begin yet. Important contracts remain unstable or incomplete:

- The beta guide and current `v2` branch disagree on at least one hook name: the guide uses `ctx.session.hook("request")`, while source currently defines `ctx.session.hook("context")`.
- The guide and source also differ on some tool context field names.
- Server plugins have no public equivalent to v1 `client.tui.showToast()` or `client.app.log()`.
- Plugin reload isolation and config-directory reload have open defects.
- The package must determine the correct location/workspace rather than use `process.cwd()` in the long-lived v2 service.

The recommended release strategy is to preserve `opencode-command-hooks` as the v1 line and publish any beta port under a separate package name, such as `opencode-command-hooks-v2`, using exact prerelease versions. Do not move the existing package's npm `latest` tag to a v2-only artifact while a large v1 population remains.

## Implementation Addendum

The opt-in beta adapter is now implemented in this repository:

- `src/v2/plugin.ts` owns the V2 Promise adapter and keeps callback failures non-blocking.
- `packages/v2` produces the separate `opencode-command-hooks-v2` package without changing the V1 package identity or release tag.
- The package pins `@opencode-ai/plugin@0.0.0-beta-18684` exactly.
- Tool hooks use direct V2 event input, and `subagent`/`agent` are normalized to the existing `task`/`subagent_type` config vocabulary.
- Session lookup supplies the authoritative project directory and agent for config discovery and command execution.
- Injection uses `ctx.session.synthetic()` with `resume: false`; toast requests produce one explicit unsupported diagnostic.
- The event consumer maps compatibility and durable execution events to `session.start`/`session.idle`, deduplicates event IDs and session starts, and is closed during plugin cleanup.
- Unit, V1 regression, packed-artifact, and gated pinned-host E2E tests cover the adapter.
- A dedicated V2 release workflow requires the pinned host E2E to pass before npm publication.

The first one-shot standalone E2E queried the plugin list before asynchronous plugin activation completed. The corrected test starts an isolated persistent server, polls the location-scoped plugin endpoint until setup finishes, and passes against `0.0.0-beta-18684`. It uses temporary HOME/XDG directories and a test-only server password, so it does not connect to or modify the normal OpenCode service.

## Research Question

- How will OpenCode 2 affect `opencode-command-hooks`?
- Which features can be migrated now, which require redesign, and which are blocked?
- How should v1 and v2 support coexist while users upgrade at different times?

## Scope

### In Scope

- OpenCode 2 beta plugin loader and authoring API.
- Tool and session lifecycle contracts.
- Session context injection, notifications, logging, location, and configuration.
- Direct impact on the current repository.
- Package compatibility, release strategy, testing, rollout, and rollback.

### Out of Scope

- Implementing the v2 adapter.
- Changing the package, source, tests, release workflow, or npm metadata.
- Promising compatibility with an API that upstream still labels beta.

## Method

- Inspected this repository's package metadata, source, tests, generated `dist`, and release workflow.
- Used Firecrawl for current OpenCode 1 docs, OpenCode 2 beta docs, upstream issues, pull requests, and source pages.
- Used Context7 for the current OpenCode plugin API documentation and examples.
- Audited upstream Git branches at these snapshots:
  - `dev`: `45cd8d76920839e4a7b6b931c4e26b52e1495636`, 2026-07-17.
  - `v2`: `987242b3e83ff7ed870b376b94394d068c7d8790`, 2026-07-17.
- Queried npm metadata for current dist-tags. At research time, stable was `1.18.3`; beta/next/dev remained prerelease channels.
- Ran five parallel focused research tracks covering the v2 API, local impact, lifecycle contracts, coexistence strategy, and rollout risks.

## Current State

### Stable and beta are separate

OpenCode 1 remains the stable line. The OpenCode 2 beta is installed from `@opencode-ai/cli@next` and runs as `opencode2`, allowing side-by-side evaluation with the stable `opencode` executable.

Upstream's migration documentation says:

- Plugins use a new API.
- Server APIs and clients use new contracts.
- V1 plugins will not work in V2.
- Detailed plugin migration guidance will be published after the API is finalized.
- Existing v1 server config, agent definitions, commands, skills, and `.opencode` files are intended to remain compatible through in-memory translation.

### Two upstream development surfaces matter

The default `dev` branch and the dedicated `v2` branch currently expose different v2 plugin capabilities.

- `dev` has early v2 package exports but lacks tool, event, and session domains in its public context.
- `v2`, which backs the beta docs, has tool hooks, event subscription, session actions, and broader client capabilities.

This branch divergence is a strong signal not to infer a stable contract from package paths alone. Migration work should pin and test a specific OpenCode beta build and matching `@opencode-ai/plugin` package.

## Impact Matrix

| Surface | Current implementation | OpenCode 2 impact | Severity | Proposed treatment |
| --- | --- | --- | --- | --- |
| Plugin export | `src/index.ts:253-405` exports a v1 `Plugin` function returning hooks | V2 loader accepts only a default `{ id, setup }` or `{ id, effect }` descriptor | Critical | New v2 entrypoint/package |
| Hook registration | Returned keys such as `tool.execute.before`, `tool.execute.after`, `event`, `chat.params` | V2 setup registers hooks imperatively through `ctx.tool.hook`, `ctx.event.subscribe`, and other domains | Critical | V2 host adapter |
| Before-tool payload | Separate `input` and mutable `output.args` | One event object with mutable `event.input`; IDs and agent are included directly | High | Normalize into shared internal context |
| After-tool payload | Args cached from before hook; `tool.result` fallback and dedupe | V2 after event includes `input`, `result`, `output`, and `outputPaths`; no cache should be necessary | High | Remove v1 cache/fallback from v2 adapter |
| Session lifecycle | Generic v1 `event` handling for `session.created`, `session.idle`, and `tool.result` | V2 has a typed event stream and durable execution events; envelope uses `data`, not v1 `properties` | High | Event normalization and dedupe |
| Session injection | `client.session.promptAsync({ path, body })` | New client shape is flat; `ctx.session.synthetic({ sessionID, text, ... })` is the likely context-only primitive | High | Injection port with explicit semantics tests |
| Toast | `client.tui.showToast({ body })` | No public server-plugin toast capability in current v2 context | High for feature parity | Defer, omit with diagnostics, or add a future TUI companion |
| Logging | `client.app.log({ body })` | No public v2 server-plugin logging facade found | Medium | Internal logger port; use supported diagnostics when finalized |
| Runtime directory | `process.cwd()` drives config discovery and command execution | V2 is a long-lived, multi-location service; ambient cwd is not a reliable project location | Critical | Capture plugin location and pass cwd explicitly |
| Agent Markdown | Directly reads `.opencode/agents` and legacy `.opencode/agent`; custom `hooks` frontmatter | V2 intends to keep all v1 agent directories compatible, but custom-field handling and agent identity must be verified | High | Preserve parser; replace discovery/context adapter |
| Provider option stripping | `chat.params` deletes `hooks` and `command_hooks` | No direct v2 equivalent is documented; v2 config decoding may ignore extras, but this must be tested | Medium | Contract test before removing behavior |
| Plugin config key | README tells users to use v1 `plugin` | Native v2 key is `plugins`; v1-shaped files are translated in memory | Medium | Do not force config migration for trial users; document native form separately |
| Shell execution | Global `Bun.$` with ambient cwd | V2 does not inject v1 `$`; Bun remains available but cwd must be explicit | High | Command runner port accepting cwd |
| Error semantics | Plugin catches failures so hooks remain non-blocking | V2 docs state an uncaught runtime-hook failure fails the intercepted operation | Critical | Keep a catch-all inside every v2 callback |
| Dependencies | `@opencode-ai/plugin` and SDK are broad v1 ranges | V2 docs require matching plugin package and host versions during beta | High | Exact prerelease pins in the v2 package |
| Test harness | E2E writes v1 `plugin` config and invokes `opencode` | Needs separate v1 stable and pinned `opencode2` suites | High | Versioned contract matrix |

## Detailed Findings

### 1. The current package cannot load in v2

The package's root export is a function:

```ts
export const CommandHooksPlugin: Plugin = async ({ client }) => {
  return {
    event: async (...) => {},
    "tool.execute.before": async (...) => {},
    "tool.execute.after": async (...) => {},
  }
}
```

The v2 loader imports the module and validates its default export as one of:

```ts
{ id: string, setup: function }
{ id: string, effect: function }
```

Invalid modules are skipped and logged. There is no automatic adapter for a v1 function returning hooks.

Confidence: high.

### 2. Tool hooks are migratable, but their contract is different

The current v2 beta source exposes:

```ts
await ctx.tool.hook("execute.before", async (event) => {
  event.input = updatedInput
})

await ctx.tool.hook("execute.after", async (event) => {
  // event.input, event.result, event.output, event.outputPaths
})
```

Useful differences from v1:

- `event.agent` is present directly.
- `event.input` is available to the after hook.
- The v1 `toolCallArgsCache` should not be needed in a v2 adapter.
- The undocumented `tool.result` fallback should not be carried into v2.
- Hook names inside the plugin context omit the `tool.` prefix.

Risks:

- Tool input is typed as `unknown` and must be narrowed.
- Built-in tool IDs and subagent input shapes must be observed in an actual beta build. The current plugin assumes a tool named `task` with `subagent_type`; v2 terminology and permission actions use `subagent`.
- The v2 guide says uncaught hook failures fail the intercepted operation. This plugin's non-blocking promise depends on handling every expected and unexpected error internally.

Confidence: high for API shape, medium for built-in tool identities.

### 3. Session lifecycle needs an adapter, not direct string substitution

The v2 public event stream includes durable events such as:

- `session.execution.started`
- `session.execution.succeeded`
- `session.execution.failed`
- `session.execution.interrupted`
- `session.input.admitted`
- `session.input.promoted`

Compatibility events including `session.created` and `session.idle` also appear in generated client types, but the long-term event contract remains in motion. V2 events use an envelope with fields such as `type`, `data`, `durable`, and `location`; the current code expects v1 `event.properties`.

Recommended normalization:

- Preserve the public command-hooks config vocabulary initially: `session.start`, `session.created`, and `session.idle`.
- Normalize v2 `session.created` to start.
- Decide whether idle means compatibility `session.idle` or durable `session.execution.succeeded`; test both and dedupe by event/session/sequence.
- Resolve agent identity with the session client if the lifecycle event does not carry it.
- Do not add a v2 `session.end` mapping until upstream defines one. The current repository advertises `session.end` in `src/types/hooks.ts:173-178` but does not implement it in `src/index.ts`; that is an existing gap, not a v2 regression.

The v2 Promise event stream is an `AsyncIterable`. Setup must start a cancellable background consumer and return cleanup. It must not await an infinite subscription inside `setup`.

Confidence: medium-high. Event names are implemented, but upstream explicitly warns they may change.

### 4. `session.synthetic` is the strongest injection candidate

The current plugin injects text with v1 `session.promptAsync`. The v2 session API provides both normal prompts and synthetic messages. Synthetic messages carry text, optional description/metadata, and delivery policy, and are represented as synthetic context in the model-facing history.

This maps closely to the plugin's intent: add deterministic hook output to context without impersonating a normal user prompt.

Proposed v2 mapping:

```ts
await ctx.session.synthetic({
  sessionID,
  text: message,
  description: "opencode-command-hooks",
  metadata: { hookId },
})
```

Before adoption, tests must establish:

- Whether default delivery queues or steers an active execution.
- Whether injection after a tool is visible at the intended continuation boundary.
- Whether synthetic insertion can cause recursion or an unwanted new model turn.
- Ordering when several hooks inject sequentially.
- Behavior after failed/interrupted executions.

Confidence: medium. The API exists and its data model fits, but exact operational semantics need runtime proof.

### 5. Toast parity is currently blocked

The v2 server plugin context does not expose a TUI client or toast method. A separate TUI plugin surface has UI toast capabilities, but a server plugin cannot currently call them through the documented v2 context.

Options, in order:

1. Keep `toast` in the shared config but report it as unsupported in the v2 beta package.
2. Wait for an upstream server notification capability.
3. Build a separate TUI companion only if upstream provides a supported bridge between server and TUI plugin surfaces.

Do not silently claim toast success in v2. Injection and command execution should continue even when toast is unavailable.

Confidence: high.

### 6. Ambient cwd is unsafe in the v2 service

The current implementation searches from and executes in `process.cwd()`:

- `src/config/global.ts:268-274`
- `src/config/agent.ts:74-81`
- `src/execution/shell.ts:177-196`

OpenCode 2 uses a background service with location-scoped plugin hosts. One process may serve multiple directories/workspaces, so process cwd is not a valid location contract.

The v2 client returns location metadata on several calls. A beta adapter may be able to capture the host location from a location-aware client response such as `ctx.agent.list()`, but upstream should ideally expose location directly in plugin context. The adapter should not be released until it has a deterministic directory source.

The shared command engine should receive cwd as an explicit argument. Configuration search and agent-file resolution should receive the same location rather than reading global process state.

Confidence: high for the risk, medium for the final upstream location API.

### 7. Existing config can coexist, but native v2 config differs

V2 intends to translate v1 config in memory. Existing users can keep:

```jsonc
{
  "plugin": ["opencode-command-hooks"]
}
```

Native v2 configuration uses:

```jsonc
{
  "plugins": [
    "opencode-command-hooks-v2@<exact-version>"
  ]
}
```

Tuple package options become `{ "package": "...", "options": { ... } }`.

Do not advise users to convert shared config to native v2 while they still run v1 against the same file. Upstream explicitly recommends keeping v1-shaped config during side-by-side evaluation.

The plugin's own `command-hooks.jsonc` contract is independent of OpenCode's root config and can remain stable. Its location resolution must still become host-location-aware.

Confidence: high.

### 8. The v2 beta is not stable enough for a production default

Evidence of active churn and risk includes:

- Official warning that plugin entrypoints, hooks, draft shapes, and configuration may change before stable release.
- Guide/source disagreement over `session.hook("request")` versus `session.hook("context")`.
- Guide/source disagreement over some tool context field names.
- An open issue where a bad plugin tool can poison all sessions in a location and replacement is not atomic.
- An open issue where changes inside config directories fail to trigger command, agent, and plugin reloads.
- An open issue where self-update can orphan the v2 background service and hang clients.
- A same-day fix restoring `opencode2 plugin list`, whose discussion reiterates intentional v1 incompatibility.

Confidence: high.

### 9. The current release artifact needs a clean baseline before branching

`package.json` publishes `dist/index.js`, but the checked-in `dist` does not match current source behavior. For example, the source contains `chat.params` stripping and newer after-hook dedupe behavior that are absent from the built artifact inspected during this research.

This is not caused by v2, but it matters for migration:

- A v2 port should not fork from behavior that exists only in source and not in the shipped artifact.
- Tests should exercise the packed artifact, not only `src`.
- Release CI builds before publish, but local E2E and repository inspection can still test stale `dist`.

Establish and document the intended v1 behavior before extracting shared code.

Confidence: high.

## Recommended Compatibility Strategy

### Decision

Keep the existing npm package as the v1 product line. Publish the v2 beta port under a separate package name and exact versions.

Suggested naming:

- V1: `opencode-command-hooks`
- V2 beta: `opencode-command-hooks-v2`

Why this is safest:

- Existing bare v1 specs continue resolving to a v1-compatible artifact.
- Moving npm `latest` cannot accidentally break all unpinned v1 users.
- V2 users opt in explicitly and can roll back by removing one package and restoring the other.
- Each package can use independent dependencies, entrypoints, tests, and release cadence while the v2 API churns.
- Support communication is unambiguous.

### Alternatives considered

| Option | Benefit | Risk | Recommendation |
| --- | --- | --- | --- |
| Separate v2 package | Strongest isolation and rollback | Temporary package-name fragmentation | Recommended during beta and transition |
| Same package, v2 on `next`/`v2` dist-tag | Preserves one package name | A future `latest` change can break v1 users; mutable tags complicate reproducibility | Acceptable only with exact versions and strict release discipline |
| Same package, v2 major on `latest` | Conventional semver | OpenCode auto-installs bare specs; many users do not pin plugin versions | Do not do while v1 remains common |
| One dual-runtime root export | One artifact | Hosts do not select a major-specific export; loader contracts differ; older v1 loaders may reject descriptors | Do not use as the primary strategy |

### Version policy

- Keep npm `latest` for `opencode-command-hooks` on the supported v1 line.
- Publish v2 beta releases only as exact versions of the separate package.
- Pin `@opencode-ai/plugin` and other v2 packages to the exact matching beta build.
- Do not depend on `next`, `beta`, or `latest` ranges inside a production plugin release.
- Add host compatibility metadata when upstream confirms enforcement for the target host, but treat it as a guardrail rather than the compatibility mechanism.
- Never unpublish v1 versions needed for rollback.

## Target Architecture

Do not duplicate the entire plugin. Keep host-independent behavior shared and isolate host contracts.

### Shared core

Retain or extract only behavior that does not know about OpenCode:

- Zod schemas and config validation.
- Global/project merge semantics.
- Hook matching.
- Template interpolation.
- Sequential command execution and output truncation.
- Non-blocking execution policy.

### V1 adapter

Own:

- Legacy returned hook object.
- V1 event payload normalization.
- V1 SDK nested `path`/`body` calls.
- V1 toast and structured logging.
- Existing tool-args cache and fallback only as long as supported versions need them.

### V2 adapter

Own:

- `Plugin.define({ id, setup })` default export.
- Imperative hook registration and cleanup.
- V2 tool event normalization.
- Event-stream background consumer and dedupe.
- Session lookup for missing agent context.
- Synthetic context injection.
- Explicit location/workspace and command cwd.
- Explicit unsupported-toast diagnostics until parity exists.

Use the Promise v2 API unless Effect provides a concrete capability the plugin needs. The current codebase is Promise-based, and choosing Effect only for conformity would increase migration scope without improving behavior.

## Draft Migration Plan

### Gate 0: Watch upstream and freeze assumptions

Actions:

- Track the v2 plugin guide, `v2` branch, package exports, and migration page.
- Record one exact OpenCode 2 build and matching plugin/client package versions for every spike.
- Open or follow upstream questions for location access, server-side notifications/logging, synthetic delivery semantics, and the `request`/`context` hook-name mismatch.

Exit criteria:

- Tool before/after, event subscription, session synthetic, and location contracts are documented consistently with source for a pinned build.

### Gate 1: Stabilize the v1 baseline

Actions:

- Rebuild `dist` and verify the packed package matches source.
- Add packed-artifact tests for current v1 behavior.
- Decide and document the actual support status of `session.end`, slash-command filters, and `tool.result` fallback.
- Pass runtime directory explicitly through the internal command/config APIs without changing v1 behavior.

Exit criteria:

- One reproducible v1 contract suite passes against the oldest and newest supported OpenCode 1 releases.
- `npm pack` contents are the artifact used by tests.

### Gate 2: Introduce host ports

Actions:

- Define narrow internal ports for lifecycle input, location, injection, notification, and logging.
- Keep schemas, matching, templates, execution, and merge logic host-neutral.
- Move v1-specific caches and payload aliases behind the v1 adapter.

Exit criteria:

- Existing v1 behavior passes unchanged through the adapter boundary.
- No v2 dependency is required by the v1 package.

### Gate 3: Build a pinned v2 prototype

Actions:

- Create a default v2 Promise plugin descriptor with a stable plugin ID.
- Register `execute.before` and `execute.after` hooks.
- Consume session events in a cancellable background task.
- Use direct v2 `event.input` in both phases; do not carry the v1 args cache.
- Resolve the plugin location deterministically and run commands with explicit cwd.
- Inject with `ctx.session.synthetic()` behind an adapter.
- Treat toast as unsupported with one clear diagnostic, not as a silent no-op.
- Catch all callback failures to preserve non-blocking tool execution.

Exit criteria:

- Prototype passes against one exact beta build.
- Before/after hooks, tool-argument filtering, session start/idle, injection, config reload, and cleanup have runtime evidence.
- A hook command failure never fails the intercepted OpenCode tool.

### Gate 4: Add a dual-host contract matrix

Minimum matrix:

| Dimension | V1 | V2 beta |
| --- | --- | --- |
| Host executable | `opencode` | `opencode2` |
| Plugin install | packed v1 package | packed exact v2 package |
| Config shape | v1 `plugin` | v1 translated and native v2 `plugins` |
| Tool phases | before and after | before and after |
| Tool filters | name and args | name and args |
| Agent hooks | project/global, singular/plural dirs | translated legacy and preferred v2 dirs |
| Session lifecycle | created and idle | created and selected execution/idle mapping |
| Injection | v1 async prompt behavior | v2 synthetic behavior |
| Toast | supported | explicit unsupported status or supported replacement |
| Location | single project and nested cwd | two simultaneous locations/workspaces |
| Failures | nonzero shell, timeout, malformed config | same plus hook callback exception |
| Reload | config and plugin updates | config and plugin updates, cleanup, no duplicate hooks |

Exit criteria:

- No unexplained behavioral divergence.
- All expected degradations are documented and surfaced to users.
- Open v2 reload defects are fixed upstream or mitigated and tested.

### Gate 5: Publish an opt-in v2 beta package

Actions:

- Publish `opencode-command-hooks-v2@<exact-prerelease>` without changing the v1 package's `latest` tag.
- State the exact supported OpenCode 2 beta build.
- Provide side-by-side install, verification, and rollback steps.
- Require users to verify active plugin IDs with `opencode2 api get /api/plugin`.
- Collect issue reports with host version, plugin version, event type, and server logs.

Exit criteria:

- At least 20 representative successful canary runs across multiple projects.
- Zero tool-blocking plugin failures.
- No unresolved injection recursion, location, or duplicate-event defects.

### Gate 6: Decide the stable package future

After OpenCode 2 and its plugin API are stable, choose one:

- Keep permanent `-v2` package separation while v1 remains maintained.
- Move v2 to a new major of `opencode-command-hooks`, but keep npm `latest` on the v1 line until users have clear pinning/migration guidance.
- Eventually move `latest` to v2 only after a declared migration window and adoption threshold.

Do not make this decision during the upstream beta.

## User Migration and Rollback

### Side-by-side trial

1. Keep `opencode` and `opencode-command-hooks` unchanged.
2. Install a pinned `opencode2` beta separately.
3. Use v1-shaped shared config initially so both hosts can read it.
4. Add the exact v2 plugin package only in an isolated v2 test config or disposable environment.
5. Verify plugin loading, model/provider credentials, agents, permissions, and hooks before regular use.

### Production migration

1. Record the exact working v1 OpenCode and plugin versions.
2. Remove the v1 plugin entry and add the exact v2 package entry in one controlled config change.
3. Verify active plugin ID, before/after execution, session injection, and project cwd.
4. Keep the old v1 config and package version available through at least one stable OpenCode 2 release cycle.

### Rollback

1. Stop using `opencode2` for the affected workflow.
2. Restore the exact prior v1 plugin spec and v1 config.
3. Restart OpenCode so cached plugin state and registrations are cleared.
4. Diagnose cache only if an exact package does not reload; cache deletion should not be the normal rollback mechanism.

Rollback triggers:

- A hook exception blocks a tool.
- Hook commands execute in the wrong directory.
- Injection triggers an unintended model turn or recursion.
- Duplicate lifecycle events execute hooks twice.
- Required toast behavior is silently lost.
- Plugin reload breaks unrelated sessions or tools.
- A beta service update causes hangs or unbounded retries.

## Recommendations

1. Do not port the production package until the v2 API is documented consistently with the beta source.
2. Keep the current npm package and `latest` tag v1-compatible.
3. Use a separate v2 beta package with exact OpenCode/plugin dependency pins.
4. Stabilize the packed v1 artifact before extracting shared code.
5. Separate host adapters from the schema/matching/execution core.
6. Use v2 tool hooks directly and avoid carrying v1 cache/fallback complexity forward.
7. Prototype injection with `session.synthetic`, but require runtime proof of delivery and recursion semantics.
8. Treat toast and structured logging as explicit parity gaps, not silent no-ops.
9. Make project location and shell cwd explicit before supporting the v2 background service.
10. Maintain a dual-host contract test matrix and a documented exact-version rollback path.

## Open Questions

- Will the stable hook be named `session.request`, `session.context`, or something else?
- What is the stable way for a server plugin to obtain its location and workspace directly?
- Will server plugins receive a supported logging and user-notification capability?
- What synthetic delivery policy is correct for injection during an active tool execution?
- Which v2 event should define the user-facing `session.idle` compatibility behavior?
- What are the stable built-in tool IDs and subagent input shapes?
- Are custom agent-frontmatter fields ignored, preserved, or forwarded into provider request options?
- Will plugin replacement become atomic and retain the last known good generation?
- What semver or compatibility guarantee will apply to the stable v2 plugin API?

## Evidence and References

### Primary current sources

- [OpenCode 2 beta introduction](https://v2.opencode.ai/) - Beta status, warnings, `@next` installation, and `opencode2`. Retrieved with Firecrawl.
- [Migrate from V1](https://v2.opencode.ai/migrate-v1) - Intentional breaking changes, v1 config translation, plugin incompatibility, side-by-side guidance, and deferred migration details. Retrieved with Firecrawl.
- [OpenCode 2 plugin guide](https://v2.opencode.ai/build/plugins) - Current beta loader, setup model, context, transforms, tool hooks, version matching, and publication guidance. Retrieved with Firecrawl and corroborated with Context7.
- [OpenCode 1 plugin guide](https://opencode.ai/docs/plugins/) - Current stable returned-hooks API, injected client, event list, toast/logging, and install behavior. Retrieved with Firecrawl and Context7.
- [V2 plugin loader source](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/supervisor.ts) - Default export validation, package loading, ordering, discovery, and reload flow. Retrieved with Firecrawl; verified in the upstream clone.
- [V2 Promise plugin contract](https://github.com/anomalyco/opencode/blob/v2/packages/plugin/src/v2/promise/plugin.ts) - `{ id, setup }`, context domains, and cleanup contract. Verified in the upstream clone; indexed by Context7.
- [V2 tool contract](https://github.com/anomalyco/opencode/blob/v2/packages/plugin/src/v2/effect/tool.ts) - Mutable before/after event fields and hook names. Retrieved with Firecrawl; verified in the upstream clone.
- [V2 session contract](https://github.com/anomalyco/opencode/blob/v2/packages/plugin/src/v2/effect/session.ts) - Session client subset and session hook surface. Verified in the upstream clone.
- [V2 host wiring](https://github.com/anomalyco/opencode/blob/v2/packages/core/src/plugin/host.ts) - Implemented event, tool, session, and location-scoped behavior. Verified in the upstream clone.
- [V2 session event schema](https://github.com/anomalyco/opencode/blob/v2/packages/schema/src/session-event.ts) - Durable execution and synthetic event contracts. Verified in the upstream clone.
- [V2 API design map](https://github.com/anomalyco/opencode/blob/dev/specs/v2/api.html) - Revised client/server operation model and session-pinned context. Retrieved with Firecrawl.
- [V2 core instructions](https://github.com/anomalyco/opencode/blob/dev/specs/v2/instructions.md) - Architectural direction toward typed, domain-oriented, sequential plugin hooks. Retrieved with Firecrawl.

### Stability and risk sources

- [PR #37540: restore plugin list diagnostics](https://github.com/anomalyco/opencode/pull/37540) - Reiterates intentional v1 plugin incompatibility and shows same-day beta repair. Retrieved with Firecrawl.
- [Issue #37533: v2 plugin list and loading report](https://github.com/anomalyco/opencode/issues/37533) - Maintainer comment that v1 plugins are incompatible with v2. Retrieved through GitHub CLI after Firecrawl discovery.
- [Issue #35963: isolate invalid plugin tools during reload](https://github.com/anomalyco/opencode/issues/35963) - Open plugin validation, atomic replacement, and location-wide failure risk. Retrieved with Firecrawl.
- [Issue #37429: config directory changes do not trigger reload](https://github.com/anomalyco/opencode/issues/37429) - Open command/agent/plugin reload defect. Retrieved with Firecrawl.
- [Issue #37521: self-update can orphan the service](https://github.com/anomalyco/opencode/issues/37521) - Open background-service hang and recovery risk. Retrieved with Firecrawl.
- [Issue #34832: v2 pre-beta event/schema audit](https://github.com/anomalyco/opencode/issues/34832) - Explicit concern about durable event names and migration-sensitive contracts. Retrieved with Firecrawl.
- [Issue #35016: execution/retry/error event redesign](https://github.com/anomalyco/opencode/issues/35016) - Direction replacing ambiguous status with typed execution lifecycle events. Retrieved with Firecrawl.
- [Issue #33896: v2 plugin skill discovery](https://github.com/anomalyco/opencode/issues/33896) - Evidence that published v2 plugin capabilities are still receiving compatibility fixes. Retrieved with Firecrawl and GitHub CLI.
- [Issue #7641: plugin and v2 SDK type mismatch](https://github.com/anomalyco/opencode/issues/7641) - Historical evidence of nested v1 versus flattened v2 client types. Retrieved through GitHub CLI after Firecrawl discovery.
- [OpenCode releases](https://github.com/anomalyco/opencode/releases) - Stable release status. Retrieved with Firecrawl and GitHub CLI.
- [npm registry: `@opencode-ai/plugin`](https://www.npmjs.com/package/@opencode-ai/plugin) - Stable and prerelease package channels. Queried with npm after Firecrawl discovery.

## Limitations

- OpenCode 2 is changing daily; this report is a point-in-time analysis for 2026-07-17.
- Some upstream beta documentation already differs from the current `v2` branch source.
- A V2 adapter, packed package test, and isolated pinned-host E2E loading test are now present and passing.
- No claim here should override a later stable OpenCode 2 migration guide or package contract.

## Follow-ups

- [x] Recheck the beta guide, exact published package types, and `v2` source before implementation.
- [ ] Obtain upstream clarification on session hook naming, location access, toast/logging, and synthetic delivery.
- [x] Add packed V2 artifact verification while preserving the V1 regression suite.
- [x] Use `opencode-command-hooks-v2` as the isolated beta package name.
- [ ] Confirm npm ownership before publishing any prerelease.
- [x] Enable the isolated pinned-host E2E loading gate.
- [ ] Expand to a dual-host runtime matrix when the blocking host defects are resolved.
