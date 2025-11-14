#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Bun TypeScript Type Checking Tests${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Current tsc --noEmit
echo -e "${YELLOW}Test 1: tsc --noEmit (baseline)${NC}"
echo "Command: tsc --noEmit"
echo "---"
if tsc --noEmit 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}"
    TEST1_RESULT="PASSED"
else
    echo -e "${RED}✗ FAILED${NC}"
    TEST1_RESULT="FAILED"
fi
TEST1_EXIT=$?
echo "Exit code: $TEST1_EXIT"
echo ""

# Test 2: bun --bun tsc --noEmit
echo -e "${YELLOW}Test 2: bun --bun tsc --noEmit${NC}"
echo "Command: bun --bun tsc --noEmit"
echo "---"
if bun --bun tsc --noEmit 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}"
    TEST2_RESULT="PASSED"
else
    echo -e "${RED}✗ FAILED${NC}"
    TEST2_RESULT="FAILED"
fi
TEST2_EXIT=$?
echo "Exit code: $TEST2_EXIT"
echo ""

# Test 3: bun build src/index.ts --target=bun
echo -e "${YELLOW}Test 3: bun build src/index.ts --target=bun${NC}"
echo "Command: bun build src/index.ts --target=bun"
echo "---"
if bun build src/index.ts --target=bun 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}"
    TEST3_RESULT="PASSED"
else
    echo -e "${RED}✗ FAILED${NC}"
    TEST3_RESULT="FAILED"
fi
TEST3_EXIT=$?
echo "Exit code: $TEST3_EXIT"
echo ""

# Test 4: bun run src/index.ts
echo -e "${YELLOW}Test 4: bun run src/index.ts${NC}"
echo "Command: bun run src/index.ts"
echo "---"
if bun run src/index.ts 2>&1; then
    echo -e "${GREEN}✓ PASSED${NC}"
    TEST4_RESULT="PASSED"
else
    echo -e "${RED}✗ FAILED${NC}"
    TEST4_RESULT="FAILED"
fi
TEST4_EXIT=$?
echo "Exit code: $TEST4_EXIT"
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo "Test 1 (tsc --noEmit):           $TEST1_RESULT (exit: $TEST1_EXIT)"
echo "Test 2 (bun --bun tsc):          $TEST2_RESULT (exit: $TEST2_EXIT)"
echo "Test 3 (bun build):              $TEST3_RESULT (exit: $TEST3_EXIT)"
echo "Test 4 (bun run):                $TEST4_RESULT (exit: $TEST4_EXIT)"
echo ""

# Determine if Bun can handle the code
if [ "$TEST3_RESULT" = "PASSED" ] || [ "$TEST4_RESULT" = "PASSED" ]; then
    echo -e "${GREEN}✓ Bun CAN load/compile the TypeScript code${NC}"
    echo "  This suggests the issue is with standalone tsc, not the code itself."
else
    echo -e "${RED}✗ Bun CANNOT load/compile the TypeScript code${NC}"
    echo "  The issue may be with the code or dependencies."
fi
