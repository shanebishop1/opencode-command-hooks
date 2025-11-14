#!/bin/bash

echo "=== Test 1: Current tsc --noEmit ==="
echo "Running: tsc --noEmit"
tsc --noEmit
echo "Exit code: $?"
echo ""

echo "=== Test 2: bun build src/index.ts --target=bun ==="
echo "Running: bun build src/index.ts --target=bun"
bun build src/index.ts --target=bun
echo "Exit code: $?"
echo ""

echo "=== Test 3: bun run src/index.ts ==="
echo "Running: bun run src/index.ts"
bun run src/index.ts
echo "Exit code: $?"
echo ""

echo "=== Test 4: bun --bun tsc --noEmit ==="
echo "Running: bun --bun tsc --noEmit"
bun --bun tsc --noEmit
echo "Exit code: $?"
