export type ReviewKey = 'next' | 'previous' | 'approve' | 'reject' | 'edit' | 'confirm';

/** Text entry and browser shortcuts must never become review decisions. */
export function reviewKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'target'>): ReviewKey | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return null;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  const actions: Readonly<Record<string, ReviewKey>> = { j: 'next', k: 'previous', a: 'approve', r: 'reject', e: 'edit', c: 'confirm' };
  return actions[event.key] ?? null;
}
