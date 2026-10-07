import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloneConfig } from '../src/core/config';
import { presetConfig } from '../src/core/line/config';
import { simulateLine } from '../src/core/line/engine';

const base = resolve('output/cli-test');
mkdirSync(base, { recursive: true });
const execute = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'scripts/simulate.ts', ...args], {
    encoding: 'utf8',
    timeout: 20000,
  });
test('CLI accepts exported config envelopes and writes reproducible results', () => {
  const config = cloneConfig();
  config.name = 'CLI test';
  config.trajectory.duration = 0.1;
  config.trajectory.step = 0.1;
  const path = resolve(base, 'input with spaces.json');
  writeFileSync(path, JSON.stringify({ config }));
  const output = resolve(base, 'valid'),
    r = execute([path, output]);
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.samples, 2);
  assert.equal(summary.status, 'OK');
  assert.equal(JSON.parse(readFileSync(resolve(output, 'config.json'), 'utf8')).name, 'CLI test');
  assert.equal(JSON.parse(readFileSync(resolve(output, 'result.json'), 'utf8')).frames.length, 2);
  assert.equal(readFileSync(resolve(output, 'trajectory.csv'), 'utf8').split('\n').length, 3);
});
test('CLI flag arguments actually select the requested NG configuration and exit 2', () => {
  const output = resolve(base, 'invalid-workspace'),
    r = execute(['--config', 'examples/outside-workspace.json', '--out', output]);
  assert.equal(r.status, 2, r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.status, 'NG');
  assert.equal(summary.samples, 5);
  assert.equal(summary.violations, 5);
  assert.equal(summary.output, output);
});
test('CLI unknown arguments and missing files fail instead of running the default case', () => {
  const bad = execute(['--typo']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /不明なオプション/);
  assert.equal(bad.stdout, '');
  assert.equal(execute(['does-not-exist.json']).status, 1);
});

test('manufacturing config and result envelopes use the same CLI and reproduce the shared engine', () => {
  for (const id of ['standard', 'rushed', 'optimized', 'overfeed']) {
    const config = presetConfig(id);
    const path = resolve(base, `line-${id}.json`);
    writeFileSync(path, JSON.stringify({ config }));
    const output = resolve(base, `line-${id}`);
    const result = execute([path, output]);
    const expected = simulateLine(config);
    assert.equal(result.status, expected.status === 'OK' ? 0 : 2, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resolve(output, 'result.json'), 'utf8')), expected);
    assert.match(readFileSync(resolve(output, 'events.csv'), 'utf8'), /time_s,level,code,message/);
  }
});
