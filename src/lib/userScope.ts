/* Per-user local storage scoping.

   All app data (projects, collections, active id, drafts) lives in
   localStorage. Keys are suffixed with the signed-in user's id so each
   account only ever sees its own data on a shared device. Legacy unscoped
   data is adopted by the first account that signs in after this update. */

let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getUserScopeId(): string | null {
  return currentUserId;
}

/** Resolve a base storage key to the current user's scoped key, adopting
    legacy unscoped data the first time that user has no scoped entry. */
export function scopedKey(base: string): string {
  if (!currentUserId) return base;
  const scoped = `${base}:${currentUserId}`;
  try {
    if (localStorage.getItem(scoped) === null) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null) {
        localStorage.setItem(scoped, legacy);
        localStorage.removeItem(base);
      }
    }
  } catch {
    // Storage unavailable — ignore.
  }
  return scoped;
}
