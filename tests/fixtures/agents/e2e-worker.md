---
description: Deterministic real-host E2E worker.
mode: subagent
model: local/deterministic
hooks:
  before:
    - run: "printf child-before > child-before.txt"
  after:
    - run: "printf child-after > child-after.txt; printf V2_CHILD_AFTER_OUTPUT"
      inject: "V2_CHILD_FRONTMATTER:{stdout}"
---

# Deterministic E2E worker

Reply exactly WORKER_DONE.
