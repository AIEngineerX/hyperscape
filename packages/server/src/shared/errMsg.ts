/**
 * Extract a human-readable error message from an unknown thrown value.
 * Replaces the repetitive `err instanceof Error ? err.message : String(err)` pattern.
 */
export function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
