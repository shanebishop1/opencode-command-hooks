import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  EventDeduplicator,
  generateToolEventId,
  generateSessionEventId,
  hasProcessedEvent,
  markEventProcessed,
  clearProcessedEvents,
  getTrackedEventCount,
  resetGlobalDeduplicator,
} from "../src/execution/dedup.js"

describe("EventDeduplicator", () => {
  let dedup: EventDeduplicator

  beforeEach(() => {
    dedup = new EventDeduplicator()
  })

  describe("hasProcessed", () => {
    it("returns false for unprocessed events", () => {
      expect(dedup.hasProcessed("event-1")).toBe(false)
    })

    it("returns true after marking an event as processed", () => {
      dedup.markProcessed("event-1")
      expect(dedup.hasProcessed("event-1")).toBe(true)
    })

    it("distinguishes between different events", () => {
      dedup.markProcessed("event-1")
      expect(dedup.hasProcessed("event-1")).toBe(true)
      expect(dedup.hasProcessed("event-2")).toBe(false)
    })
  })

  describe("markProcessed", () => {
    it("marks a single event as processed", () => {
      dedup.markProcessed("event-1")
      expect(dedup.hasProcessed("event-1")).toBe(true)
    })

    it("marks multiple events as processed", () => {
      dedup.markProcessed("event-1")
      dedup.markProcessed("event-2")
      dedup.markProcessed("event-3")
      expect(dedup.hasProcessed("event-1")).toBe(true)
      expect(dedup.hasProcessed("event-2")).toBe(true)
      expect(dedup.hasProcessed("event-3")).toBe(true)
    })

    it("idempotently marks the same event multiple times", () => {
      dedup.markProcessed("event-1")
      dedup.markProcessed("event-1")
      dedup.markProcessed("event-1")
      expect(dedup.hasProcessed("event-1")).toBe(true)
      expect(dedup.getTrackedCount()).toBe(1)
    })
  })

  describe("clear", () => {
    it("clears all tracked events", () => {
      dedup.markProcessed("event-1")
      dedup.markProcessed("event-2")
      dedup.markProcessed("event-3")
      expect(dedup.getTrackedCount()).toBe(3)

      dedup.clear()
      expect(dedup.getTrackedCount()).toBe(0)
      expect(dedup.hasProcessed("event-1")).toBe(false)
      expect(dedup.hasProcessed("event-2")).toBe(false)
      expect(dedup.hasProcessed("event-3")).toBe(false)
    })

    it("allows re-processing after clear", () => {
      dedup.markProcessed("event-1")
      dedup.clear()
      expect(dedup.hasProcessed("event-1")).toBe(false)
      dedup.markProcessed("event-1")
      expect(dedup.hasProcessed("event-1")).toBe(true)
    })
  })

  describe("getTrackedCount", () => {
    it("returns 0 for empty deduplicator", () => {
      expect(dedup.getTrackedCount()).toBe(0)
    })

    it("returns correct count after marking events", () => {
      dedup.markProcessed("event-1")
      expect(dedup.getTrackedCount()).toBe(1)
      dedup.markProcessed("event-2")
      expect(dedup.getTrackedCount()).toBe(2)
    })

    it("returns correct count after clearing", () => {
      dedup.markProcessed("event-1")
      dedup.markProcessed("event-2")
      expect(dedup.getTrackedCount()).toBe(2)
      dedup.clear()
      expect(dedup.getTrackedCount()).toBe(0)
    })
  })
})

describe("generateToolEventId", () => {
  it("generates deterministic IDs", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "after")
    const id2 = generateToolEventId("hook-1", "task", "session-1", "after")
    expect(id1).toBe(id2)
  })

  it("generates different IDs for different hooks", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "after")
    const id2 = generateToolEventId("hook-2", "task", "session-1", "after")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different tools", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "after")
    const id2 = generateToolEventId("hook-1", "bash", "session-1", "after")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different sessions", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "after")
    const id2 = generateToolEventId("hook-1", "task", "session-2", "after")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different phases", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "before")
    const id2 = generateToolEventId("hook-1", "task", "session-1", "after")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different callIds", () => {
    const id1 = generateToolEventId("hook-1", "task", "session-1", "after", "call-1")
    const id2 = generateToolEventId("hook-1", "task", "session-1", "after", "call-2")
    expect(id1).not.toBe(id2)
  })

  it("uses correct format without callId", () => {
    const id = generateToolEventId("my-hook", "task", "sess-123", "after")
    expect(id).toBe("my-hook:task:sess-123:after")
  })

  it("uses correct format with callId", () => {
    const id = generateToolEventId("my-hook", "task", "sess-123", "after", "call-456")
    expect(id).toBe("my-hook:task:sess-123:after:call-456")
  })
})

describe("generateSessionEventId", () => {
  it("generates deterministic IDs", () => {
    const id1 = generateSessionEventId("hook-1", "session.start", "session-1")
    const id2 = generateSessionEventId("hook-1", "session.start", "session-1")
    expect(id1).toBe(id2)
  })

  it("generates different IDs for different hooks", () => {
    const id1 = generateSessionEventId("hook-1", "session.start", "session-1")
    const id2 = generateSessionEventId("hook-2", "session.start", "session-1")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different events", () => {
    const id1 = generateSessionEventId("hook-1", "session.start", "session-1")
    const id2 = generateSessionEventId("hook-1", "session.idle", "session-1")
    expect(id1).not.toBe(id2)
  })

  it("generates different IDs for different sessions", () => {
    const id1 = generateSessionEventId("hook-1", "session.start", "session-1")
    const id2 = generateSessionEventId("hook-1", "session.start", "session-2")
    expect(id1).not.toBe(id2)
  })

  it("uses correct format", () => {
    const id = generateSessionEventId("bootstrap", "session.start", "sess-456")
    expect(id).toBe("bootstrap:session.start:sess-456")
  })
})

describe("Global deduplicator functions", () => {
  beforeEach(() => {
    resetGlobalDeduplicator()
  })

  afterEach(() => {
    resetGlobalDeduplicator()
  })

  describe("hasProcessedEvent", () => {
    it("returns false for unprocessed events", () => {
      expect(hasProcessedEvent("event-1")).toBe(false)
    })

    it("returns true after marking an event as processed", () => {
      markEventProcessed("event-1")
      expect(hasProcessedEvent("event-1")).toBe(true)
    })
  })

  describe("markEventProcessed", () => {
    it("marks events as processed", () => {
      markEventProcessed("event-1")
      expect(hasProcessedEvent("event-1")).toBe(true)
    })

    it("persists across multiple calls", () => {
      markEventProcessed("event-1")
      markEventProcessed("event-2")
      expect(hasProcessedEvent("event-1")).toBe(true)
      expect(hasProcessedEvent("event-2")).toBe(true)
    })
  })

  describe("clearProcessedEvents", () => {
    it("clears all tracked events", () => {
      markEventProcessed("event-1")
      markEventProcessed("event-2")
      expect(getTrackedEventCount()).toBe(2)

      clearProcessedEvents()
      expect(getTrackedEventCount()).toBe(0)
      expect(hasProcessedEvent("event-1")).toBe(false)
      expect(hasProcessedEvent("event-2")).toBe(false)
    })
  })

  describe("getTrackedEventCount", () => {
    it("returns 0 initially", () => {
      expect(getTrackedEventCount()).toBe(0)
    })

    it("returns correct count after marking events", () => {
      markEventProcessed("event-1")
      expect(getTrackedEventCount()).toBe(1)
      markEventProcessed("event-2")
      expect(getTrackedEventCount()).toBe(2)
    })

    it("returns 0 after clearing", () => {
      markEventProcessed("event-1")
      clearProcessedEvents()
      expect(getTrackedEventCount()).toBe(0)
    })
  })

  describe("global instance persistence", () => {
    it("maintains state across function calls", () => {
      markEventProcessed("event-1")
      markEventProcessed("event-2")

      // Call from different functions
      expect(hasProcessedEvent("event-1")).toBe(true)
      expect(hasProcessedEvent("event-2")).toBe(true)
      expect(getTrackedEventCount()).toBe(2)
    })

    it("creates new instance after reset", () => {
      markEventProcessed("event-1")
      expect(getTrackedEventCount()).toBe(1)

      resetGlobalDeduplicator()
      expect(getTrackedEventCount()).toBe(0)
      expect(hasProcessedEvent("event-1")).toBe(false)
    })
  })
})

describe("Integration scenarios", () => {
  let dedup: EventDeduplicator

  beforeEach(() => {
    dedup = new EventDeduplicator()
  })

  it("prevents duplicate tool hook execution", () => {
    const eventId = generateToolEventId("tests-after-task", "task", "session-1", "after")

    // First execution
    if (!dedup.hasProcessed(eventId)) {
      dedup.markProcessed(eventId)
      // Would execute hook here
    }

    // Duplicate event arrives
    if (!dedup.hasProcessed(eventId)) {
      // Should not reach here
      throw new Error("Duplicate event was not deduplicated")
    }

    expect(dedup.getTrackedCount()).toBe(1)
  })

  it("allows different phases of same hook to execute", () => {
    const beforeId = generateToolEventId("my-hook", "task", "session-1", "before")
    const afterId = generateToolEventId("my-hook", "task", "session-1", "after")

    dedup.markProcessed(beforeId)
    expect(dedup.hasProcessed(beforeId)).toBe(true)
    expect(dedup.hasProcessed(afterId)).toBe(false)

    dedup.markProcessed(afterId)
    expect(dedup.hasProcessed(beforeId)).toBe(true)
    expect(dedup.hasProcessed(afterId)).toBe(true)
    expect(dedup.getTrackedCount()).toBe(2)
  })

  it("allows same hook on different tools to execute", () => {
    const taskId = generateToolEventId("my-hook", "task", "session-1", "after")
    const bashId = generateToolEventId("my-hook", "bash", "session-1", "after")

    dedup.markProcessed(taskId)
    expect(dedup.hasProcessed(taskId)).toBe(true)
    expect(dedup.hasProcessed(bashId)).toBe(false)

    dedup.markProcessed(bashId)
    expect(dedup.hasProcessed(taskId)).toBe(true)
    expect(dedup.hasProcessed(bashId)).toBe(true)
    expect(dedup.getTrackedCount()).toBe(2)
  })

  it("allows same hook on different sessions to execute", () => {
    const session1Id = generateToolEventId("my-hook", "task", "session-1", "after")
    const session2Id = generateToolEventId("my-hook", "task", "session-2", "after")

    dedup.markProcessed(session1Id)
    expect(dedup.hasProcessed(session1Id)).toBe(true)
    expect(dedup.hasProcessed(session2Id)).toBe(false)

    dedup.markProcessed(session2Id)
    expect(dedup.hasProcessed(session1Id)).toBe(true)
    expect(dedup.hasProcessed(session2Id)).toBe(true)
    expect(dedup.getTrackedCount()).toBe(2)
  })

  it("allows same hook on different invocations to execute", () => {
    const call1Id = generateToolEventId("my-hook", "task", "session-1", "after", "call-1")
    const call2Id = generateToolEventId("my-hook", "task", "session-1", "after", "call-2")

    dedup.markProcessed(call1Id)
    expect(dedup.hasProcessed(call1Id)).toBe(true)
    expect(dedup.hasProcessed(call2Id)).toBe(false)

    dedup.markProcessed(call2Id)
    expect(dedup.hasProcessed(call1Id)).toBe(true)
    expect(dedup.hasProcessed(call2Id)).toBe(true)
    expect(dedup.getTrackedCount()).toBe(2)
  })

  it("handles session hooks correctly", () => {
    const startId = generateSessionEventId("bootstrap", "session.start", "session-1")
    const idleId = generateSessionEventId("bootstrap", "session.idle", "session-1")

    dedup.markProcessed(startId)
    expect(dedup.hasProcessed(startId)).toBe(true)
    expect(dedup.hasProcessed(idleId)).toBe(false)

    dedup.markProcessed(idleId)
    expect(dedup.hasProcessed(startId)).toBe(true)
    expect(dedup.hasProcessed(idleId)).toBe(true)
    expect(dedup.getTrackedCount()).toBe(2)
  })
})
