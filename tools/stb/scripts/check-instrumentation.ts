/**
 * Assert that every instrumented template still agrees with its hook class.
 *
 * In-tag comments produce no AST node, so nothing else in the toolchain — not
 * the language service, not eslint, not the type checker — can see a commented
 * snapshot id. This is the only check that catches an id drifting from the
 * derived class that ships in its place.
 *
 *   bun scripts/check-instrumentation.ts [--repo <root>]
 *
 * Exits non-zero on any finding. Passing vacuously (no instrumented templates
 * yet) is a valid result, and is reported as such rather than silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { checkInstrumentation, type TemplateSource } from '../src/emit/instrumentation';

const TEMPLATE_ROOT = 'src/frontend/packages';

function templateFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.html'))
    .map((f) => join(root, f))
    .filter((f) => !f.includes('node_modules'));
}

function parseArgs(argv: string[]): { repo: string } {
  const i = argv.indexOf('--repo');
  // Default to the Stratos checkout this tool lives inside (tools/stb/scripts → repo root).
  return { repo: i === -1 ? resolve(import.meta.dirname, '../../..') : resolve(argv[i + 1]) };
}

const { repo } = parseArgs(process.argv.slice(2));
const root = join(repo, TEMPLATE_ROOT);

const sources: TemplateSource[] = templateFiles(root).map((file) => ({
  file: relative(repo, file),
  html: readFileSync(file, 'utf8'),
}));

const findings = checkInstrumentation(sources);

if (findings.length === 0) {
  console.log(`check-instrumentation: ${sources.length} templates scanned, no findings`);
  process.exit(0);
}

for (const f of findings) {
  console.error(`${f.file}: [${f.problem}] ${f.snapshotId} — ${f.detail}`);
}
console.error(`\n${findings.length} finding(s) across ${sources.length} templates`);
process.exit(1);
