/** Case/whitespace-insensitive form used to enforce one display name per person. */
export function normalizeDisplayName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
