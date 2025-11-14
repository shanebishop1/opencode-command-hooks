# Bun TypeScript Type Checking Analysis Report

## Executive Summary

This report documents the investigation into using Bun's built-in type checking capabilities as an alternative to standalone TypeScript (`tsc`), which has been experiencing persistent issues in this project.

## Project Context

- **Project**: opencode-command-hooks
- **Type**: Bun project with TypeScript
- **Main Entry**: src/index.ts
- **Dependencies**: 
  - @opencode-ai/plugin (^1.0.0)
  - @opencode-ai/sdk (^1.0.65)
- **TypeScript Config**: tsconfig.json with strict mode enabled
- **Bun Version Requirement**: >=1.0.0

## Problem Statement

The project has been experiencing TypeScript type checking issues with standalone `tsc --noEmit`. The hypothesis is that Bun's runtime may be able to handle the code successfully, indicating the issue is with tsc's module resolution or environment, not the code itself.

## Test Plan

Four complementary tests were designed to isolate the issue:

### Test 1: Baseline (Current Setup)
```bash
tsc --noEmit
```
- **Purpose**: Establish baseline behavior with current configuration
- **Expected**: May fail with module resolution or type errors
- **Indicates**: Whether tsc has issues

### Test 2: Bun-Executed TypeScript Compiler
```bash
bun --bun tsc --noEmit
```
- **Purpose**: Run tsc through Bun's runtime instead of Node.js
- **Expected**: Should work if Bun's module resolution is better
- **Indicates**: Whether the issue is tsc or the runtime environment

### Test 3: Bun Build System
```bash
bun build src/index.ts --target=bun
```
- **Purpose**: Use Bun's native build system to compile TypeScript
- **Expected**: Should succeed if code is valid
- **Indicates**: Whether Bun can successfully parse and compile the code

### Test 4: Bun Runtime Direct Execution
```bash
bun run src/index.ts
```
- **Purpose**: Execute TypeScript directly with Bun's runtime
- **Expected**: Should execute if Bun can load and interpret the code
- **Indicates**: Whether Bun's runtime can handle the code

## Implementation

### Updated package.json Scripts

Added three new scripts for testing:

```json
{
  "typecheck": "tsc --noEmit",
  "typecheck:bun": "bun --bun tsc --noEmit",
  "typecheck:bun-build": "bun build src/index.ts --target=bun",
  "typecheck:bun-run": "bun run src/index.ts"
}
```

### Test Execution

To run all tests:
```bash
npm run typecheck          # Test 1
npm run typecheck:bun      # Test 2
npm run typecheck:bun-build # Test 3
npm run typecheck:bun-run  # Test 4
```

Or use the provided shell script:
```bash
bash run-all-tests.sh
```

## Key Files

- **src/index.ts**: Main plugin entry point
- **src/config/global.ts**: Global configuration loader (uses Bun.file API)
- **src/types/hooks.ts**: Type definitions
- **types/hooks.ts**: Duplicate type definitions (should be consolidated)
- **tests/config.global.test.ts**: Bun test suite

## Code Analysis

### Potential Issues Identified

1. **Bun API Usage**: The code uses `Bun.file()` API in `src/config/global.ts`
   - This is Bun-specific and won't work with Node.js
   - tsc may not understand this API
   - Bun's runtime should handle it natively

2. **Module Resolution**: 
   - tsconfig.json uses `"moduleResolution": "bundler"`
   - This is designed for bundlers like Bun
   - Standalone tsc may have issues with this setting

3. **Type Imports**:
   - Uses `import type { Plugin } from "@opencode-ai/plugin"`
   - Depends on external packages that may not be properly resolved

4. **Duplicate Types**:
   - `/types/hooks.ts` and `/src/types/hooks.ts` are identical
   - Should consolidate to avoid confusion

## Expected Outcomes

### Scenario A: Bun Succeeds, tsc Fails
- **Implication**: The issue is with tsc's module resolution or Node.js environment
- **Recommendation**: Switch to `bun --bun tsc --noEmit` or use Bun's build system
- **Action**: Update typecheck script to use Bun

### Scenario B: Both Succeed
- **Implication**: The environment was the issue (missing dependencies, etc.)
- **Recommendation**: Ensure dependencies are properly installed
- **Action**: No change needed

### Scenario C: Both Fail
- **Implication**: There's an actual code issue
- **Recommendation**: Debug the specific error messages
- **Action**: Fix the underlying code issue

### Scenario D: Bun Fails, tsc Succeeds
- **Implication**: Unlikely, but would indicate Bun-specific incompatibility
- **Recommendation**: Investigate Bun version or configuration
- **Action**: Check Bun version and tsconfig

## Recommendations

### If Bun Succeeds (Scenarios A, B)

1. **Update typecheck script**:
   ```json
   "typecheck": "bun --bun tsc --noEmit"
   ```

2. **Alternative: Use Bun's build system**:
   ```json
   "typecheck": "bun build src/index.ts --target=bun"
   ```

3. **Consolidate type definitions**:
   - Remove `/types/hooks.ts`
   - Keep `/src/types/hooks.ts`
   - Update exports if needed

### If Bun Fails (Scenario C)

1. **Examine error messages** from all four tests
2. **Check dependency installation**: `bun install`
3. **Verify tsconfig.json** settings
4. **Debug specific type errors**

## Next Steps

1. Run the test suite using the provided scripts
2. Document results in this report
3. Implement recommended changes based on outcomes
4. Verify fix with `npm run typecheck` and `npm test`

## Files Modified

- `package.json`: Added three new typecheck scripts
- `run-all-tests.sh`: Test runner script (new)
- `BUNTYPECHECK_REPORT.md`: This report (new)

## Conclusion

This investigation will determine whether Bun's runtime and build system can successfully handle the TypeScript code, which would indicate that the issue is with standalone tsc rather than the code itself. The results will guide the decision on whether to switch to Bun-based type checking.
