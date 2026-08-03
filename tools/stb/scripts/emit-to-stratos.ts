/**
 * Write an stb pack into a Stratos checkout as build inputs.
 *
 * Emits the three artefacts whose targets and consumption points are verified:
 *
 *   company-config.json  → src/frontend/packages/theme/     (ng build asset glob)
 *   brand assets         → custom-src/frontend/assets/custom (asset copier)
 *   stratos.yaml         → repo root                         (extension generator + index transformer)
 *
 * Everything written here is consumed inside a single `make build` run and read
 * by nothing afterwards, so this is a pre-build step and needs no build changes.
 *
 * Token values and element-scoped CSS are deliberately NOT emitted: the token
 * target is undecided and the stylesheet still needs registering in
 * angular.json `styles[]`.
 *
 *   bun scripts/emit-to-stratos.ts --pack <dir> --repo <root> [options]
 *
 *     --title "Acme Console"      document title for stratos.yaml
 *     --exclude @stratosui/git    repeatable; packages to leave out of the build
 *     --include @example/theme    repeatable; packages to force in
 *     --desktop                   build the desktop extensions package
 *     --dry-run                   report what would change, write nothing
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TARGETS, fullCompanyConfig, rewriteAssetRefs, stratosYaml } from '../src/emit/stratos-target';

interface Options {
  pack: string;
  repo: string;
  title?: string;
  include: string[];
  exclude: string[];
  desktop?: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { pack: '', repo: '', include: [], exclude: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--pack': opts.pack = resolve(next()); break;
      case '--repo': opts.repo = resolve(next()); break;
      case '--title': opts.title = next(); break;
      case '--include': opts.include.push(next()); break;
      case '--exclude': opts.exclude.push(next()); break;
      case '--desktop': opts.desktop = true; break;
      case '--dry-run': opts.dryRun = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!opts.pack || !opts.repo) throw new Error('both --pack and --repo are required');
  return opts;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function emit(opts: Options): string[] {
  const actions: string[] = [];
  const write = (path: string, body: string) => {
    const unchanged = existsSync(path) && readFileSync(path, 'utf8') === body;
    actions.push(`${unchanged ? 'unchanged' : opts.dryRun ? 'would write' : 'wrote'}  ${path}`);
    if (!unchanged && !opts.dryRun) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, body);
    }
  };

  // --- brand assets -------------------------------------------------------
  const packAssets = join(opts.pack, 'assets');
  const assetFiles = existsSync(packAssets) ? readdirSync(packAssets).filter((f) => !f.startsWith('.')) : [];
  const assetDir = join(opts.repo, TARGETS.assetDir);
  if (assetFiles.length && !opts.dryRun) mkdirSync(assetDir, { recursive: true });
  for (const file of assetFiles) {
    const dest = join(assetDir, file);
    actions.push(`${opts.dryRun ? 'would copy ' : 'copied'}   ${dest}`);
    if (!opts.dryRun) copyFileSync(join(packAssets, file), dest);
  }

  // --- company config -----------------------------------------------------
  // The pack carries a sparse patch; the shipped file is the base. Merging here
  // means the emitted document is complete, so the consumer's one-level spread
  // cannot blank a sibling key.
  const packConfig = join(opts.pack, 'company-config.json');
  const shippedPath = join(opts.repo, TARGETS.companyConfig);
  if (existsSync(packConfig)) {
    const merged = fullCompanyConfig(readJson(shippedPath), readJson(packConfig));
    const withUrls = rewriteAssetRefs(merged, assetFiles);
    write(shippedPath, JSON.stringify(withUrls, null, 2) + '\n');
  } else {
    actions.push(`skipped    ${shippedPath} (pack has no company-config.json)`);
  }

  // --- stratos.yaml -------------------------------------------------------
  if (opts.title || opts.include.length || opts.exclude.length || opts.desktop !== undefined) {
    write(
      join(opts.repo, TARGETS.stratosYaml),
      stratosYaml({ title: opts.title, include: opts.include, exclude: opts.exclude, desktop: opts.desktop }),
    );
  } else {
    actions.push('skipped    stratos.yaml (no title or package selection given)');
  }

  return actions;
}

if (import.meta.main) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    for (const line of emit(opts)) console.log(line);
    if (opts.dryRun) console.log('\ndry run — nothing written');
  } catch (e) {
    console.error(`emit-to-stratos: ${(e as Error).message}`);
    process.exit(1);
  }
}
