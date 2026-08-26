# Issue #5 Investigation: `session.idle` and Subagents

## Summary

[Issue #5](https://github.com/shanebishop1/opencode-command-hooks/issues/5) reports that hooks configured for `session.idle` can notify the user while subagents are still active. This makes notifications such as "Waiting for input" unreliable because the primary agent may still be working.

The underlying limitation comes from OpenCode: its `session.idle` event contains a `sessionID`, but it does not identify whether the session is a primary session or a child/subagent session, report active subagent counts, or mean specifically that user input is required.

However, OpenCode represents subagents as child sessions whose session records have a `parentID`. The plugin now mitigates the most likely source of false notifications by fetching the session associated with an idle event and excluding child-session idle events by default.

This mitigation is useful, but it is not equivalent to a true upstream `session.awaiting_user` event.

## Reported Behavior

The reporter uses a session hook similar to:

```jsonc
{
  "session": [
    {
      "id": "cmux-session-idle",
      "when": { "event": "session.idle" },
      "run": ["notify-user.sh 'Waiting for input'"]
    }
  ]
}
```

They expect the hook to run only when OpenCode has finished working and needs the user's attention. Instead, it also runs around subagent activity, causing the user to return to a terminal where work is still underway.

The issue proposes several possible solutions:

- A new `session.awaiting_user` event.
- Event metadata such as `active_subagents`.
- A plugin configuration option such as `excludeSubagentWait`.

## Current Plugin Behavior

The plugin does not create or determine the meaning of `session.idle`. In `src/index.ts`, it subscribes to OpenCode's general plugin event hook and handles events whose type is `session.idle`:

```ts
if (event.type === "session.idle") {
  const sessionId = normalizeString(event.properties?.sessionID)
  const agent = normalizeString(event.properties?.agent)

  await handleSessionEvent("session.idle", sessionId, agent, client)
}
```

`handleSessionEvent` then matches configured hooks and executes them. It does not inspect the session represented by `sessionID`, determine whether it has a parent, or track active subagents.

Consequently, a global `session.idle` hook runs for every idle event received from OpenCode, including idle events emitted by child sessions.

## OpenCode Behavior

### Event Shape

This repository currently resolves these relevant packages:

- `@opencode-ai/plugin@1.0.218`
- `@opencode-ai/sdk@1.0.218`

In that SDK, `session.idle` is defined as:

```ts
export type EventSessionIdle = {
  type: "session.idle"
  properties: {
    sessionID: string
  }
}
```

The newer `session.status` event is not sufficient by itself either:

```ts
export type EventSessionStatus = {
  type: "session.status"
  properties: {
    sessionID: string
    status: SessionStatus
  }
}
```

The status values are `idle`, `busy`, and `retry`. Neither event includes `parentID`, active child sessions, an active subagent count, or an indication that user input is required.

OpenCode also marks `session.idle` as deprecated and emits it as a compatibility event whenever a session's status is set to `idle`.

### Subagent Sessions

OpenCode's `task` tool creates a separate session for a subagent and sets the primary session as its parent:

```ts
Session.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${agent.name} subagent)`,
})
```

The resulting session record exposes an optional `parentID`. Therefore:

- A primary/root session normally has no `parentID`.
- A subagent/child session has a `parentID`.
- Both can emit structurally identical `session.idle` events.

### Related Upstream Reports

Several upstream OpenCode issues describe the same class of problem:

- [`anomalyco/opencode#13334`](https://github.com/anomalyco/opencode/issues/13334): subagents trigger excessive OS notifications.
- [`anomalyco/opencode#14780`](https://github.com/anomalyco/opencode/issues/14780): request to suppress `session.idle` for subagents.
- [`anomalyco/opencode#26069`](https://github.com/anomalyco/opencode/issues/26069): request for consumers to distinguish agent and subagent events.
- [`anomalyco/opencode#30043`](https://github.com/anomalyco/opencode/issues/30043): request to add `parentID` to `session.status` events.

In issue #30043, an OpenCode maintainer suggested that consumers fetch the session and check whether it has a parent. This confirms that session lookup is the currently supported way to distinguish root and child sessions.

## Most Likely Explanation

The most likely source of the reported false notification is not that the primary session becomes idle while synchronously waiting on a foreground subagent. Instead, each subagent is its own child session and emits its own idle event when it completes. This plugin currently treats that child idle event exactly like a primary-session idle event.

This distinction matters because filtering child idle events is feasible in this plugin. Determining whether the primary session is genuinely waiting for user input is not currently feasible from `session.idle` alone.

The exact event sequence should still be reproduced before implementation. The report's wording could also describe a parent idle event while another parallel or background subagent remains active. A child-session filter would not solve that separate case.

## Ownership Assessment

The issue has two layers:

1. **Upstream semantic limitation:** OpenCode's idle event does not mean "user attention required" and lacks enough metadata to express that meaning reliably.
2. **Plugin-side opportunity:** This plugin can identify child sessions through a session lookup and avoid treating their idle events as primary-session completion.

Therefore, the issue should not be dismissed as entirely upstream. The plugin can probably mitigate the common false-positive case, while the complete requested semantics still require upstream support.

## Implemented Plugin Change

### Recommended Approach

`session.idle` hooks now default to root/primary sessions. An explicit condition named `rootSessionOnly` controls the scope because the implementation filters child-session events rather than proving that no subagent is active.

Possible names include:

- `rootSessionOnly: true`
- `primarySessionOnly: true`
- `includeChildSessions: false`

`rootSessionOnly: true` is the clearest description of what can be guaranteed from `parentID`. Set it to `false` when a hook intentionally needs idle events from both root and child sessions.

Example:

```jsonc
{
  "session": [
    {
      "id": "cmux-session-idle",
      "when": {
        "event": "session.idle",
        "rootSessionOnly": true
      },
      "run": ["notify-user.sh 'Waiting for input'"]
    }
  ]
}
```

### Why Root-Only Is The Default For Idle

Most users interpret a session idle hook as a signal that the primary interaction has stopped and may need attention. Child-session completion is better handled with task/tool hooks, while notifying for every child idle event creates the false-positive behavior reported here. Therefore root-only behavior is the logical default for `session.idle`; users who intentionally consume child idle events can opt in with `rootSessionOnly: false`.

Other session events retain all-session behavior by default and can opt into root-only handling with `rootSessionOnly: true`.

### Implementation

1. `SessionHookWhenSchema` and `SessionHookWhen` accept an optional `rootSessionOnly` boolean.
2. `session.idle` treats an omitted value as `true`; other session events treat it as `false`.
3. `session.created` uses the `parentID` already present in the event.
4. `session.idle` fetches the session with `client.session.get({ path: { id: sessionId } })` only when at least one matched hook requires root filtering.
5. Hooks requiring root scope are excluded when `parentID` is present, while hooks with `rootSessionOnly: false` still run.
6. Session lookup failures are logged and fail open rather than silently dropping hooks.
7. Documentation clarifies that filtering child sessions does not guarantee that no background work remains.

The exact SDK response wrapper should be verified during implementation. Generated OpenCode clients generally return a result containing `data`, but the installed type should be followed rather than assumed.

### Caching Consideration

Session parentage does not change after creation, so a small in-memory cache keyed by `sessionID` could avoid repeated API requests. This optimization is not necessary for an initial implementation unless measurements or tests show repeated lookup overhead. The smallest correct implementation should be preferred first.

## Cases This Would Fix

- A foreground subagent completes and its child session emits `session.idle`.
- Several subagents run and each completed child session emits an idle event.
- A notification hook should apply only to the primary OpenCode session.

## Cases This Would Not Fully Fix

- The primary session itself emits idle while a background subagent remains active.
- A user needs a strict guarantee that OpenCode is waiting for keyboard input.
- OpenCode is blocked on a permission or question event rather than transitioning to idle.
- Active work exists outside OpenCode's parent/child session model.
- Session lookup fails and there is no cached `session.created` information.

Those cases require richer upstream semantics, such as:

- A dedicated `session.awaiting_user` or `session.attention_required` event.
- `parentID` and active-child metadata on status events.
- Explicit session states for waiting on tools, subagents, permissions, or user answers.

## Verification Plan

### Unit Tests

Tests cover:

- `rootSessionOnly` is accepted by configuration validation.
- A root session with no `parentID` runs a matching idle hook.
- A child session with `parentID` does not run a `rootSessionOnly` idle hook.
- A child session still runs an ordinary idle hook without the new condition.
- A failed session lookup does not crash event processing.
- Existing `session.created` behavior remains unchanged.

### Integration/Reproduction Test

Run OpenCode with an idle hook that records the event session ID, then invoke a foreground subagent. Capture:

- The primary session ID.
- The child session ID and `parentID`.
- The order of `session.status` and `session.idle` events.
- Whether the primary session emits idle before or after the task tool completes.
- Whether only the child emits the premature event described by the reporter.

Repeat with parallel or background subagents if the installed OpenCode version supports them. This determines whether root-session filtering completely addresses the report or only the most common case.

### Regression Commands

After implementation, run:

```sh
npm run lint
npm run typecheck
bun test
```

## Recommended Response to Issue #5

```md
Thanks for the report. I investigated both this plugin and OpenCode's event implementation.

OpenCode emits `session.idle` separately for primary and child/subagent sessions, but the event itself contains only `sessionID`. This plugin currently handles every idle event, so a subagent completing can trigger the same notification hook as the primary session.

OpenCode does expose `parentID` when the session is fetched, so the plugin now filters idle events to root/primary sessions by default. This addresses the common case where a child session's idle event causes a premature notification. If you intentionally need idle hooks for every child session, set `rootSessionOnly: false`.

The limitation is that this would not create a true "awaiting user" signal. If the primary session becomes idle while background work remains active, OpenCode does not currently expose enough information on the idle event to guarantee that no subagents are running. A dedicated attention-required event or richer status metadata would still need to be implemented upstream.

The implementation includes unit coverage for root sessions, child sessions, the all-session override, mixed hook scopes, creation-event parent metadata, and lookup failures.
```

## Recommendation

Ship the root-session filtering as a plugin fix while clearly documenting the upstream limitation. Once the released version is confirmed against the reporter's workflow, issue #5 can be closed as mitigated rather than claiming OpenCode now provides a true user-attention event.
