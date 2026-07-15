// @vitest-environment node
//
// node, not the default jsdom: this is pure logic, and jsdom makes
// import.meta.url an http: URL that cannot be resolved to a path. A `?raw`
// import is not an option either — vitest stubs CSS imports to an empty string.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { publicTier, chain, affects, brandToValues, valuesToBrand, type Brand } from '@/contract/brand';
import { emitCss } from '@/parse/css-emitter';
import { parseCss } from '@/parse/css-parser';

// The real contract, not a fixture. These assertions are about what the
// contract says; a fixture would only prove the regexes match themselves.
const vocab = readFileSync(fileURLToPath(new URL('../../contract/vocabulary.css', import.meta.url)), 'utf8');

describe('public tier', () => {
  it('reads the mapping the contract declares rather than deriving it', () => {
    const pub = publicTier(vocab);
    expect(pub.size).toBe(136);
    expect(pub.get('color-accent')).toBe('--v-accent'); // colour drops its namespace
    expect(pub.get('font-body')).toBe('--v-font-body'); // everything else keeps it
    expect(pub.get('spacing')).toBe('--v-spacing');
  });
});

describe('affects — the contract answering what a name reaches', () => {
  it('follows the var() chain out to the group tokens', () => {
    const reached = affects(vocab, 'color-surface');
    expect(reached).toContain('color-surface'); // itself
    expect(reached).toContain('color-card-surface');
    expect(reached).toContain('color-dialog-surface');
    expect(reached).toContain('color-table-surface');
  });

  it('does not claim names that are pinned to a literal', () => {
    // popup is the one group that deliberately does not chain to surface.
    expect(affects(vocab, 'color-surface')).not.toContain('color-popup-surface');
  });

  it('follows a chain transitively', () => {
    // --v-link -> --v-accent, so link moves when accent moves.
    expect(affects(vocab, 'color-accent')).toContain('color-link');
  });

  it('reports a smaller reach in dark where the theme pins a name', () => {
    // .dark-theme re-declares these two as literals, severing them from text.
    const light = affects(vocab, 'color-text', 'light');
    const dark = affects(vocab, 'color-text', 'dark');
    expect(light).toContain('color-table-header-text');
    expect(light).toContain('color-code-text');
    expect(dark).not.toContain('color-table-header-text');
    expect(dark).not.toContain('color-code-text');
    expect(dark).toContain('color-card-text'); // still chained in both
  });

  it('is empty for a name outside the contract', () => {
    expect(affects(vocab, 'color-not-a-token')).toEqual([]);
  });

  it('severs the chain when a literal overrides it', () => {
    expect(chain(vocab, 'light').get('--v-table-header-text')).toBe('--v-text');
    expect(chain(vocab, 'dark').has('--v-table-header-text')).toBe(false);
  });
});

describe('round trip', () => {
  const brand: Brand = {
    contractVersion: 1,
    name: 'Acme',
    light: { 'color-accent': '#7c3aed', 'font-body': 'Georgia, serif', 'radius-control': '0px' },
    dark: { 'color-accent': '#a78bfa' },
  };

  it('survives brand -> css -> brand unchanged', () => {
    const pub = publicTier(vocab);
    const { root, dark } = brandToValues(brand, pub);
    const css = emitCss(root, dark);
    const back = valuesToBrand(parseCss(css), pub, { contractVersion: 1, name: 'Acme' });
    expect(back).toEqual(brand);
  });

  it('emits the private tier, never @theme — a dropped-in @theme would be inert', () => {
    const { root, dark } = brandToValues(brand, publicTier(vocab));
    const css = emitCss(root, dark);
    expect(css).toContain('--v-accent: #7c3aed;');
    expect(css).toContain(':root');
    expect(css).toContain('.dark-theme');
    expect(css).not.toContain('@theme');
    expect(css).not.toContain('--color-accent'); // the public tier is the app's, not the brand's
  });

  it('drops names outside the contract instead of emitting them', () => {
    const rogue: Brand = { ...brand, light: { 'color-accent': '#fff', 'color-invented': '#000' } };
    const { root } = brandToValues(rogue, publicTier(vocab));
    expect(root.has('--v-accent')).toBe(true);
    expect([...root.keys()].some((k) => k.includes('invented'))).toBe(false);
  });
});
