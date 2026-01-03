/**
 * Utility functions for opencode-command-hooks
 */

/**
 * Helper to extract string values from event properties
 */
export const normalizeString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined
}
