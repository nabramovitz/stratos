/* Styling contract — where a public name lives.
 *
 * The rule is stated in semantics.json's $comment; this is its one
 * implementation. It lived inline in loop.html once, and a second copy in
 * probe.html, and the copies drifted into reading --color-page as a 'page'
 * group token. A rule every consumer needs is a rule no consumer should be
 * restating.
 */

export interface Semantics {
  global: Record<string, unknown>;
  groups: Record<string, { means: string; note?: string }>;
}

/** Exact match against the closed global set. Globals win — see groupOf. */
export const isGlobal = (sem: Semantics, name: string): boolean => Object.hasOwn(sem.global, name);

/**
 * The fallback rule alone: the segment after the type namespace, if it names a
 * declared group. Exported so the probe can show where this disagrees with the
 * global set — on its own it is NOT the rule. Use groupOf.
 */
export function prefixGroup(sem: Semantics, name: string): string | null {
  const seg = name.match(/^(?:color|font|radius|weight|shadow|text)-([a-z]+)(?:-|$)/)?.[1];
  return seg && Object.hasOwn(sem.groups, seg) ? seg : null;
}

/**
 * The group a name belongs to, or null if it is global or unplaceable.
 *
 * Order matters. A group name can also BE a global name — 'page' and 'code'
 * both are — so prefix-matching alone reads --color-page (the global floor
 * colour) as a 'page' token, while --radius-page really is one. Only the
 * closed global set can tell those apart, so it is checked first and the
 * prefix is the fallback.
 */
export const groupOf = (sem: Semantics, name: string): string | null =>
  isGlobal(sem, name) ? null : prefixGroup(sem, name);

/** Names the contract cannot place: neither global nor a known group. */
export const unplaceable = (sem: Semantics, names: string[]): string[] =>
  names.filter((n) => !isGlobal(sem, n) && !groupOf(sem, n));
