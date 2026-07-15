/* Styling contract — the brand file, and what a name reaches.
 *
 * A brand file is DATA: values for public contract names, light and dark. It
 * never contains selectors or CSS. The emitter turns it into the one thing a
 * runtime can consume — `:root` / `.dark-theme` blocks of the private tier —
 * because `@theme` is a build-time Tailwind directive and a dropped-in file
 * carrying it would never be compiled. The public tier ships with the app; a
 * brand only ever moves values underneath it.
 *
 * Nothing here derives the public->private mapping by rule. vocabulary.css
 * already declares it (`--color-accent: var(--v-accent)`), so it is read, not
 * guessed.
 */

/** A brand file. Sparse: an omitted name keeps the contract's default. */
export interface Brand {
  contractVersion: number;
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  /**
   * Which real face each of Tailwind's weight names resolves to, e.g.
   * { medium: '700' }. Keyed by the name, valued by the weight.
   *
   * This exists because the browser's own fallback is NUMERIC and therefore
   * wrong: ask Lato for 500, which it does not ship, and you get 400 — the
   * regular — so `font-medium` renders identically to body text and nothing
   * says so. The right fallback is by APPEARANCE, and appearance cannot be
   * computed: Lato's 700 reads like Roboto's 500 because Lato's bold is
   * restrained, which no arithmetic over the numbers predicts. So the map is
   * authored by eye, per family, and travels with the brand.
   *
   * Not mode-split — a face is a face in light and dark alike.
   */
  weights?: Record<string, string>;
}

/** Tailwind's weight ladder: the names a template already carries. */
export const WEIGHT_NAMES = [
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
] as const;

const weightVar = (name: string) => `--font-weight-${name}`;

export type Mode = 'light' | 'dark';

const themeBlock = (css: string) => css.match(/@theme[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const namedBlock = (css: string, sel: string) =>
  css.match(new RegExp(`${sel}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

/**
 * Public name -> the private var it reads, exactly as the contract declares it.
 * `color-accent` -> `--v-accent`, `font-body` -> `--v-font-body`.
 */
export function publicTier(vocabCss: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, priv] of themeBlock(vocabCss).matchAll(
    /^\s+--([a-z0-9-]+):\s*var\((--v-[a-z0-9-]+)\)/gm,
  )) {
    if (name && priv) out.set(name, priv);
  }
  return out;
}

/**
 * Private var -> the private var it chains to, for one mode. A name with a
 * literal value has no entry.
 *
 * Dark is not the same graph as light: `.dark-theme` re-declares some names
 * with literals, which BREAKS the chain there. --v-card-hover follows nothing
 * in either mode, but a name pinned in dark stops tracking its global, and a
 * tool that reported the light graph for dark would be lying.
 */
export function chain(vocabCss: string, mode: Mode = 'light'): Map<string, string> {
  const decls = (block: string) => [...block.matchAll(/^\s+(--v-[a-z0-9-]+):\s*([^;]+);/gm)];
  const out = new Map<string, string>();
  const apply = (block: string) => {
    for (const [, name, value] of decls(block)) {
      if (!name || !value) continue;
      const to = value.trim().match(/^var\((--v-[a-z0-9-]+)\)$/)?.[1];
      if (to) out.set(name, to);
      else out.delete(name); // a literal pins the name and severs the chain
    }
  };
  apply(namedBlock(vocabCss, ':root'));
  if (mode === 'dark') apply(namedBlock(vocabCss, '\\.dark-theme'));
  return out;
}

/**
 * The public names that move when `name` moves, in one mode — `name` included.
 *
 * This is the contract answering "what does this affect" about itself. It is
 * the token tier only: it says --color-surface reaches the table and card
 * surfaces, not which pixels those paint. tie.json carries the next hop, from
 * a group to the components that declare it.
 */
export function affects(vocabCss: string, name: string, mode: Mode = 'light'): string[] {
  const pub = publicTier(vocabCss);
  const start = pub.get(name);
  if (!start) return [];

  const links = chain(vocabCss, mode);
  const followers = new Map<string, string[]>();
  for (const [from, to] of links) followers.set(to, [...(followers.get(to) ?? []), from]);

  const reached = new Set<string>([start]);
  const queue = [start];
  for (let v = queue.shift(); v; v = queue.shift()) {
    for (const f of followers.get(v) ?? []) {
      if (reached.has(f)) continue; // var() cycles are illegal CSS, but do not hang on one
      reached.add(f);
      queue.push(f);
    }
  }

  const back = new Map([...pub].map(([p, v]) => [v, p]));
  return [...reached].map((v) => back.get(v)).filter((p): p is string => Boolean(p)).sort();
}

/** Brand -> the value Maps emitCss wants, keyed by private var. */
export function brandToValues(brand: Brand, pub: Map<string, string>) {
  const tier = (values: Record<string, string>) => {
    const out = new Map<string, string>();
    for (const [name, value] of Object.entries(values)) {
      const priv = pub.get(name);
      if (priv) out.set(priv, value); // a name outside the contract is not emitted
    }
    return out;
  };
  const root = tier(brand.light);
  // The weight map rides the same channel. Tailwind compiles font-medium to
  // `font-weight: var(--font-weight-medium)`, so redeclaring that at :root
  // retargets every existing use with no rebuild and no template edit.
  // Verified live: font-medium moved 500 -> 700 from an inline :root property.
  for (const [name, value] of Object.entries(brand.weights ?? {})) {
    if ((WEIGHT_NAMES as readonly string[]).includes(name)) root.set(weightVar(name), value);
  }
  return { root, dark: tier(brand.dark) };
}

/** The way back: parsed `:root`/`.dark-theme` values -> a brand file. */
export function valuesToBrand(
  parsed: { root: Map<string, string>; dark: Map<string, string> },
  pub: Map<string, string>,
  meta: { contractVersion: number; name: string },
): Brand {
  const back = new Map([...pub].map(([p, v]) => [v, p]));
  const tier = (values: Map<string, string>) => {
    const out: Record<string, string> = {};
    for (const [priv, value] of values) {
      const name = back.get(priv);
      if (name) out[name] = value;
    }
    return out;
  };
  const weights: Record<string, string> = {};
  for (const name of WEIGHT_NAMES) {
    const v = parsed.root.get(weightVar(name));
    if (v) weights[name] = v;
  }
  const brand: Brand = { ...meta, light: tier(parsed.root), dark: tier(parsed.dark) };
  if (Object.keys(weights).length) brand.weights = weights;
  return brand;
}
