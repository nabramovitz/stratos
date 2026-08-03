/**
 * The instrumentation filter.
 *
 * Instrumentation is authored inside JS-style comments in the element tag:
 *
 *   <button class="mat-button stb-auth-login-sign-in"
 *           /* stb-snapshot-id="auth.login.sign-in" *\/ >
 *
 * Angular's template lexer consumes those comments as trivia, so they produce no
 * AST node and never reach the DOM. Production therefore needs no transform at
 * all — the committed state is already clean. Capture builds run
 * `uncommentInstrumentation` to make the attributes live for the harvester.
 *
 * The shipped hook is a derived class, not an attribute, so element-scoped CSS
 * has something to select and nothing verbose ships.
 */

/**
 * The shipped hook class for a snapshot id.
 *
 * Both sides compute this independently — templates carry it, stb's CSS emitter
 * derives it — so no mapping artefact has to be kept in sync.
 *
 * Deliberately not injective: `a.b-c` and `a-b.c` both derive to `stb-a-b-c`.
 * Forbidding `-` in id segments would restore injectivity at the cost of
 * readable ids, so instead `checkInstrumentation` asserts uniqueness over the
 * ids actually in use.
 */
export function deriveHookClass(snapshotId: string): string {
  return `stb-${snapshotId.replace(/\./g, '-')}`;
}

/**
 * An in-tag comment carrying stb attributes.
 *
 * Scoped to comments that mention `stb-`/`stba-` so unrelated in-tag comments
 * are left alone. Known limit: an attribute value containing a literal `*` `/`
 * pair terminates the match early. Not worth guarding until an id needs one.
 */
const STB_COMMENT = /\/\*(\s*(?:stb|stba)-[\s\S]*?)\*\//g;

/**
 * Capture builds only: open the comments so the attributes become real.
 *
 * Additive and reversible — production never runs this, so a failure here
 * cannot affect anything that ships.
 */
export function uncommentInstrumentation(html: string): string {
  return html.replace(STB_COMMENT, '$1');
}

/**
 * Element open tags. The comment alternative comes before the catch-all so a
 * comment containing `>` is consumed rather than ending the tag early, and the
 * quoted-string alternatives keep `>` inside attribute values from doing the
 * same.
 */
const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|\/\*[\s\S]*?\*\/|[^>"'])*)>/g;

const SNAPSHOT_ID = /\bstb-snapshot-id\s*=\s*"([^"]*)"/;
const CLASS_ATTR = /\bclass\s*=\s*"([^"]*)"/;

export interface InstrumentedElement {
  tag: string;
  snapshotId: string;
  /** Static class tokens on the element (bound classes are not visible here). */
  classes: string[];
}

/** Every element carrying a commented `stb-snapshot-id`. */
export function findInstrumentation(html: string): InstrumentedElement[] {
  const found: InstrumentedElement[] = [];
  for (const match of html.matchAll(OPEN_TAG)) {
    const tag = match[1] ?? '';
    const attrs = match[2] ?? '';
    const id = SNAPSHOT_ID.exec(attrs);
    if (!id) continue;
    const cls = CLASS_ATTR.exec(attrs);
    found.push({
      tag,
      snapshotId: id[1] ?? '',
      classes: (cls?.[1] ?? '').split(/\s+/).filter(Boolean),
    });
  }
  return found;
}

export type InstrumentationProblem = 'missing-hook' | 'collision';

export interface InstrumentationFinding {
  file: string;
  snapshotId: string;
  problem: InstrumentationProblem;
  detail: string;
}

export interface TemplateSource {
  file: string;
  html: string;
}

/**
 * The check the mechanism makes mandatory.
 *
 * In-tag comments have no AST surface — no language service, lint rule or type
 * checker can see the commented id — so drift between an id and its hook class
 * is invisible to every other tool in the chain. This is the only thing that
 * catches it.
 *
 * `missing-hook`: the derived class is absent from the element's static class.
 * `collision`:    two distinct ids derive to the same class.
 */
export function checkInstrumentation(sources: TemplateSource[]): InstrumentationFinding[] {
  const findings: InstrumentationFinding[] = [];
  const byClass = new Map<string, { file: string; snapshotId: string }>();

  for (const { file, html } of sources) {
    for (const el of findInstrumentation(html)) {
      const hook = deriveHookClass(el.snapshotId);

      if (!el.classes.includes(hook)) {
        findings.push({
          file,
          snapshotId: el.snapshotId,
          problem: 'missing-hook',
          detail: `<${el.tag}> is missing the derived hook class "${hook}"${
            el.classes.length ? ` (has: ${el.classes.join(' ')})` : ' (no static class)'
          }`,
        });
      }

      const seen = byClass.get(hook);
      if (seen && seen.snapshotId !== el.snapshotId) {
        findings.push({
          file,
          snapshotId: el.snapshotId,
          problem: 'collision',
          detail: `derives to "${hook}", which "${seen.snapshotId}" in ${seen.file} already uses`,
        });
      } else if (!seen) {
        byClass.set(hook, { file, snapshotId: el.snapshotId });
      }
    }
  }

  return findings;
}
