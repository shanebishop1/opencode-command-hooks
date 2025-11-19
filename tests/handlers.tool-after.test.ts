import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { handleToolExecuteAfter } from "../src/handlers/tool-after.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

describe("handleToolExecuteAfter", () => {
  const testDir = "/tmp/opencode-hooks-handler-test";
  const originalCwd = process.cwd();

  // Setup test environment with a config file
  beforeAll(() => {
    // Create test directory structure
    try {
      mkdirSync(join(testDir, ".opencode"), { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Write config file
    const configContent = JSON.stringify({
      tool: [
        {
          id: "test-hook",
          when: { phase: "after", tool: "test-tool" },
          run: ["echo 'hello'"],
          inject: { as: "user", template: "Output: {stdout}" }
        }
      ],
      session: []
    });
    
    writeFileSync(join(testDir, ".opencode", "command-hooks.jsonc"), configContent);

    // Switch to test directory so loadGlobalConfig finds our config
    process.chdir(testDir);
  });

  afterAll(() => {
    // Restore CWD
    process.chdir(originalCwd);
    
    // Cleanup
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should pass model from session to prompt when injecting message", async () => {
    // Mock client
    const mockSessionGet = mock(() => Promise.resolve({ 
      model: { providerID: "anthropic", modelID: "claude-3-5" } 
    }));
    
    const mockSessionPrompt = mock(() => Promise.resolve({}));

    const mockClient = {
      session: {
        get: mockSessionGet,
        prompt: mockSessionPrompt
      }
    };

    // Event data
    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-123",
      callId: "call-1"
    };

    // Execute handler
    await handleToolExecuteAfter(event as any, mockClient as any);

    // Verify session.get was called
    expect(mockSessionGet).toHaveBeenCalled();
    expect(mockSessionGet).toHaveBeenCalledWith({ path: { id: "session-123" } });

    // Verify session.prompt was called with model
    expect(mockSessionPrompt).toHaveBeenCalled();
    
    // Cast to any to avoid strict tuple type checks in tests
    const calls = mockSessionPrompt.mock.calls as any[];
    const promptCall = calls[0];
    const promptArg = promptCall[0];
    
    expect(promptArg.path.id).toBe("session-123");
    expect(promptArg.body.noReply).toBe(true);
    expect(promptArg.body.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5" });
  });

  it("should gracefully handle missing model in session info", async () => {
    // Mock client where session.get returns no model
    const mockSessionGet = mock(() => Promise.resolve({ 
      // No model property
      otherData: "test"
    }));
    
    const mockSessionPrompt = mock(() => Promise.resolve({}));

    const mockClient = {
      session: {
        get: mockSessionGet,
        prompt: mockSessionPrompt
      }
    };

    // Event data
    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-123",
      callId: "call-2"
    };

    // Execute handler
    await handleToolExecuteAfter(event as any, mockClient as any);

    // Verify session.get was called
    expect(mockSessionGet).toHaveBeenCalled();

    // Verify session.prompt was called WITHOUT model
    expect(mockSessionPrompt).toHaveBeenCalled();
    
    // Cast to any to avoid strict tuple type checks in tests
    const calls = mockSessionPrompt.mock.calls as any[];
    const promptCall = calls[0];
    const promptArg = promptCall[0];
    
    expect(promptArg.body.noReply).toBe(true);
    expect(promptArg.body.model).toBeUndefined();
  });

  it("should gracefully handle session.get failure", async () => {
    // Mock client where session.get throws
    const mockSessionGet = mock(() => Promise.reject(new Error("Network error")));
    
    const mockSessionPrompt = mock(() => Promise.resolve({}));

    const mockClient = {
      session: {
        get: mockSessionGet,
        prompt: mockSessionPrompt
      }
    };

    // Event data
    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-123",
      callId: "call-3"
    };

    // Execute handler
    await handleToolExecuteAfter(event as any, mockClient as any);

    // Verify session.get was called
    expect(mockSessionGet).toHaveBeenCalled();

    // Verify session.prompt was called WITHOUT model (fallback)
    expect(mockSessionPrompt).toHaveBeenCalled();
    
    // Cast to any to avoid strict tuple type checks in tests
    const calls = mockSessionPrompt.mock.calls as any[];
    const promptCall = calls[0];
    const promptArg = promptCall[0];
    
    expect(promptArg.body.noReply).toBe(true);
    expect(promptArg.body.model).toBeUndefined();
  });
});
