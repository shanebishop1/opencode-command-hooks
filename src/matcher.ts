import picomatch from "picomatch"

/**
 * Keep glob parsing and matching on the same deliberately explicit options.
 * Picomatch does not treat leading `#` as a comment; `nonegate` also makes a
 * leading `!` literal instead of implicitly negating the pattern.
 */
const TOOL_ARG_GLOB_OPTIONS = {
  nonegate: true,
  strictBrackets: true,
} as const

/** Compile a tool-argument glob using the options used by runtime matching. */
export const compileToolArgGlob = (pattern: string): RegExp =>
  picomatch.makeRe(pattern, TOOL_ARG_GLOB_OPTIONS)

/** Compile a tool-argument regex using the runtime's JavaScript semantics. */
export const compileToolArgRegex = (pattern: string): RegExp =>
  new RegExp(pattern)
