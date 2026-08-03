// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  deriveHookClass,
  uncommentInstrumentation,
  findInstrumentation,
  checkInstrumentation,
} from '@/emit/instrumentation';

describe('deriveHookClass', () => {
  it('prefixes and flattens the dotted id', () => {
    expect(deriveHookClass('auth.login.sign-in')).toBe('stb-auth-login-sign-in');
  });

  it('handles a single-segment id', () => {
    expect(deriveHookClass('dashboard')).toBe('stb-dashboard');
  });

  it('produces a valid CSS class token', () => {
    expect(deriveHookClass('auth.login.sign-in')).toMatch(/^[a-zA-Z][\w-]*$/);
  });

  it('is not injective — the reason checkInstrumentation asserts uniqueness', () => {
    expect(deriveHookClass('a.b-c')).toBe(deriveHookClass('a-b.c'));
  });
});

describe('uncommentInstrumentation', () => {
  it('opens a comment carrying stb attributes', () => {
    const html = '<button /* stb-snapshot-id="a.b" */ class="x">go</button>';
    expect(uncommentInstrumentation(html)).toBe('<button  stb-snapshot-id="a.b"  class="x">go</button>');
  });

  it('opens a multi-line comment with several attributes', () => {
    const html = [
      '<button class="x stb-a-b"',
      '        /* stb-snapshot-id="a.b"',
      '           stba-description="Primary action" */ >',
    ].join('\n');
    const out = uncommentInstrumentation(html);
    expect(out).toContain('stb-snapshot-id="a.b"');
    expect(out).toContain('stba-description="Primary action"');
    expect(out).not.toContain('/*');
    expect(out).not.toContain('*/');
  });

  it('leaves unrelated in-tag comments alone', () => {
    const html = '<button /* TODO: revisit this */ class="x">go</button>';
    expect(uncommentInstrumentation(html)).toBe(html);
  });

  it('is a no-op on a template with no instrumentation', () => {
    const html = '<div class="wrapper"><span>hello</span></div>';
    expect(uncommentInstrumentation(html)).toBe(html);
  });
});

describe('findInstrumentation', () => {
  it('reads the id and the static classes', () => {
    const html = '<button class="mat-button stb-a-b" /* stb-snapshot-id="a.b" */ >go</button>';
    expect(findInstrumentation(html)).toEqual([
      { tag: 'button', snapshotId: 'a.b', classes: ['mat-button', 'stb-a-b'] },
    ]);
  });

  it('does not end the tag early on a > inside the comment or an attribute', () => {
    const html = '<button title="a > b" /* stb-snapshot-id="a.b" note: x > y */ class="stb-a-b">go</button>';
    const found = findInstrumentation(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.classes).toContain('stb-a-b');
  });

  it('ignores elements with no instrumentation', () => {
    expect(findInstrumentation('<div class="x">plain</div>')).toEqual([]);
  });

  it('finds several instrumented elements', () => {
    const html = [
      '<div class="stb-page" /* stb-snapshot-id="page" */ >',
      '  <span class="stb-page-icon" /* stb-snapshot-id="page.icon" */ ></span>',
      '</div>',
    ].join('\n');
    expect(findInstrumentation(html).map((e) => e.snapshotId)).toEqual(['page', 'page.icon']);
  });
});

describe('checkInstrumentation', () => {
  it('passes when every id carries its derived hook class', () => {
    const sources = [
      { file: 'a.html', html: '<button class="x stb-auth-login-sign-in" /* stb-snapshot-id="auth.login.sign-in" */ >go</button>' },
    ];
    expect(checkInstrumentation(sources)).toEqual([]);
  });

  it('passes vacuously on templates with no instrumentation', () => {
    expect(checkInstrumentation([{ file: 'a.html', html: '<div>plain</div>' }])).toEqual([]);
  });

  it('reports drift when the hook class is absent', () => {
    const sources = [
      { file: 'a.html', html: '<button class="mat-button" /* stb-snapshot-id="auth.login.sign-in" */ >go</button>' },
    ];
    const findings = checkInstrumentation(sources);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.problem).toBe('missing-hook');
    expect(findings[0]?.detail).toContain('stb-auth-login-sign-in');
  });

  it('reports drift when the id was renamed but the class was not', () => {
    const sources = [
      { file: 'a.html', html: '<button class="stb-auth-login-sign-in" /* stb-snapshot-id="auth.login.submit" */ >go</button>' },
    ];
    expect(checkInstrumentation(sources)[0]).toMatchObject({
      problem: 'missing-hook',
      snapshotId: 'auth.login.submit',
    });
  });

  it('reports a collision between two ids that derive to one class', () => {
    const sources = [
      { file: 'a.html', html: '<i class="stb-a-b-c" /* stb-snapshot-id="a.b-c" */ ></i>' },
      { file: 'b.html', html: '<i class="stb-a-b-c" /* stb-snapshot-id="a-b.c" */ ></i>' },
    ];
    const findings = checkInstrumentation(sources);
    expect(findings.filter((f) => f.problem === 'collision')).toHaveLength(1);
    expect(findings[0]?.detail).toContain('a.b-c');
  });

  it('does not call the same id in two files a collision', () => {
    const sources = [
      { file: 'a.html', html: '<i class="stb-a-b" /* stb-snapshot-id="a.b" */ ></i>' },
      { file: 'b.html', html: '<i class="stb-a-b" /* stb-snapshot-id="a.b" */ ></i>' },
    ];
    expect(checkInstrumentation(sources)).toEqual([]);
  });
});
