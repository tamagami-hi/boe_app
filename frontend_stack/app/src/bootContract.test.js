import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appDir = resolve(process.cwd(), 'app');
const distDir = join(appDir, 'dist');
const built = existsSync(join(distDir, 'index.html')) && existsSync(join(distDir, 'assets'));

if (!built) {
  console.warn(
    '[bootContract] app/dist is missing so the built bundle was not executed. '
    + 'Run `npm run build:android` from frontend_stack/app. '
    + 'The release path enforces this in emu/boe_update.sh.',
  );
}

const describeBuilt = built ? describe : describe.skip;

describeBuilt('the built bundle', () => {
  test('evaluates every chunk without throwing', () => {
    const run = () => execFileSync(
      process.execPath,
      ['scripts/check-bundle-boots.mjs'],
      { cwd: appDir, encoding: 'utf8', stdio: 'pipe' },
    );
    let output = '';
    expect(() => { output = run(); }).not.toThrow();
    expect(output).toContain('Bundle boot OK');
  }, 60000);

  test('emits an acyclic chunk graph', () => {
    const assets = readdirSync(join(distDir, 'assets'));
    const variant = assets.some((name) => /admin/i.test(name)) ? 'admin' : 'client';
    const output = execFileSync(
      process.execPath,
      ['scripts/check-android-dist.mjs', `--variant=${variant}`],
      { cwd: appDir, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(output).toContain('chunk graph acyclic');
  }, 60000);
});
