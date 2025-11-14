/**
 * Event deduplication module for opencode-command-hooks
 *
 * Prevents duplicate hook executions by tracking processed events in memory.
 * This protects against plugin API bugs where the same event might fire twice.
 *
 * Key features:
 * - Maintains a set of processed event IDs
 * - Generates deterministic, unique event IDs per hook + context combination
 * - Supports clearing old entries for memory management
 * - Debug logging via OPENCODE_HOOKS_DEBUG environment variable
 */

const LOG_PREFIX = "[opencode-command-hooks]"

/**
 * Check if debug logging is enabled
 */
function isDebugEnabled(): boolean {
  return process.env.OPENCODE_HOOKS_DEBUG === "1" || process.env.OPENCODE_HOOKS_DEBUG === "true"
}

/**
 * Generate a unique event ID for a tool hook execution
 *
 * Combines hookId, toolName, sessionId, and phase to create a deterministic,
 * unique identifier for a specific tool hook execution context.
 *
 * @param hookId - The hook's unique identifier
 * @param toolName - Name of the tool being executed
 * @param sessionId - ID of the session where the tool is being called
 * @param phase - Execution phase: "before" or "after"
 * @returns Unique event ID string
 *
 * @example
 * ```typescript
 * const eventId = generateToolEventId("tests-after-task", "task", "session-123", "after")
 * // Returns: "tests-after-task:task:session-123:after"
 * ```
 */
export function generateToolEventId(
  hookId: string,
  toolName: string,
  sessionId: string,
  phase: "before" | "after"
): string {
  return `${hookId}:${toolName}:${sessionId}:${phase}`
}

/**
 * Generate a unique event ID for a session hook execution
 *
 * Combines hookId, event type, and sessionId to create a deterministic,
 * unique identifier for a specific session hook execution context.
 *
 * @param hookId - The hook's unique identifier
 * @param event - Session event type (e.g., "session.start", "session.idle")
 * @param sessionId - ID of the session
 * @returns Unique event ID string
 *
 * @example
 * ```typescript
 * const eventId = generateSessionEventId("bootstrap", "session.start", "session-123")
 * // Returns: "bootstrap:session.start:session-123"
 * ```
 */
export function generateSessionEventId(
  hookId: string,
  event: string,
  sessionId: string
): string {
  return `${hookId}:${event}:${sessionId}`
}

/**
 * Event deduplicator class
 *
 * Tracks processed events to prevent duplicate hook executions.
 * Uses an in-memory Set to store processed event IDs.
 *
 * @example
 * ```typescript
 * const dedup = new EventDeduplicator()
 *
 * const eventId = generateToolEventId("my-hook", "task", "session-1", "after")
 *
 * if (!dedup.hasProcessed(eventId)) {
 *   // Execute hook
 *   dedup.markProcessed(eventId)
 * }
 *
 * // Later, clear old entries if needed
 * dedup.clear()
 * ```
 */
export class EventDeduplicator {
  /**
   * Set of processed event IDs
   * @private
   */
  private processedEvents: Set<string> = new Set()

  /**
   * Check if an event has already been processed
   *
   * @param eventId - The event ID to check
   * @returns true if the event has been processed, false otherwise
   */
  hasProcessed(eventId: string): boolean {
    const processed = this.processedEvents.has(eventId)

    if (isDebugEnabled()) {
      console.log(
        `${LOG_PREFIX} Dedup check: eventId="${eventId}" processed=${processed} (total tracked: ${this.processedEvents.size})`
      )
    }

    return processed
  }

  /**
   * Mark an event as processed
   *
   * @param eventId - The event ID to mark as processed
   */
  markProcessed(eventId: string): void {
    this.processedEvents.add(eventId)

    if (isDebugEnabled()) {
      console.log(
        `${LOG_PREFIX} Dedup mark: eventId="${eventId}" (total tracked: ${this.processedEvents.size})`
      )
    }
  }

  /**
   * Clear all processed events
   *
   * Useful for memory management or resetting state between sessions.
   * Use with caution as this will allow previously-processed events to be
   * executed again.
   */
  clear(): void {
    const previousSize = this.processedEvents.size
    this.processedEvents.clear()

    if (isDebugEnabled()) {
      console.log(`${LOG_PREFIX} Dedup cleared: removed ${previousSize} tracked events`)
    }
  }

  /**
   * Get the number of tracked events
   *
   * Useful for monitoring and debugging.
   *
   * @returns Number of processed events currently tracked
   */
  getTrackedCount(): number {
    return this.processedEvents.size
  }
}

/**
 * Global singleton instance of EventDeduplicator
 *
 * Provides a module-level deduplication state that persists across
 * multiple hook executions within the same plugin lifecycle.
 *
 * @private
 */
let globalDeduplicator: EventDeduplicator | null = null

/**
 * Get or create the global event deduplicator instance
 *
 * @returns The global EventDeduplicator instance
 */
function getGlobalDeduplicator(): EventDeduplicator {
  if (!globalDeduplicator) {
    globalDeduplicator = new EventDeduplicator()
    if (isDebugEnabled()) {
      console.log(`${LOG_PREFIX} Dedup: initialized global deduplicator`)
    }
  }
  return globalDeduplicator
}

/**
 * Check if an event has been processed using the global deduplicator
 *
 * Convenience function for checking event deduplication using the
 * module-level singleton instance.
 *
 * @param eventId - The event ID to check
 * @returns true if the event has been processed, false otherwise
 */
export function hasProcessedEvent(eventId: string): boolean {
  return getGlobalDeduplicator().hasProcessed(eventId)
}

/**
 * Mark an event as processed using the global deduplicator
 *
 * Convenience function for marking events as processed using the
 * module-level singleton instance.
 *
 * @param eventId - The event ID to mark as processed
 */
export function markEventProcessed(eventId: string): void {
  getGlobalDeduplicator().markProcessed(eventId)
}

/**
 * Clear all processed events using the global deduplicator
 *
 * Convenience function for clearing the module-level singleton instance.
 * Use with caution as this will allow previously-processed events to be
 * executed again.
 */
export function clearProcessedEvents(): void {
  getGlobalDeduplicator().clear()
}

/**
 * Get the number of tracked events in the global deduplicator
 *
 * Useful for monitoring and debugging.
 *
 * @returns Number of processed events currently tracked
 */
export function getTrackedEventCount(): number {
  return getGlobalDeduplicator().getTrackedCount()
}

/**
 * Reset the global deduplicator instance
 *
 * This is primarily useful for testing. It destroys the current
 * global instance so a new one will be created on next use.
 *
 * @private
 */
export function resetGlobalDeduplicator(): void {
  if (globalDeduplicator && isDebugEnabled()) {
    console.log(`${LOG_PREFIX} Dedup: reset global deduplicator`)
  }
  globalDeduplicator = null
}
