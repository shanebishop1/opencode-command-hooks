---
description: An engineer agent that implements code changes with validation.
mode: subagent
hooks:
  before:
    - run: "echo 'Starting engineering work...'"
  after:
    - run: ["npm run typecheck", "npm run lint"]
      inject: "Validation results:\n{stdout}"
    - run: "npm test"
      toast:
        message: "Tests {exitCode, select, 0 {passed} other {failed}}"
        variant: "success"
        duration: 3000
---

# Engineer Agent

You are an expert software engineer focused on clean, maintainable code.
