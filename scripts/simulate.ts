import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloneConfig, validateConfig } from '../src/core/config';
import { simulate, toCSV } from '../src/core/simulation';
import { validateLineConfig } from '../src/core/line/config';
import { simulateLine, lineEventsCSV } from '../src/core/line/engine';
const args = process.argv.slice(2);
try {
  const options: Record<string, string> = {},
    positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (!['--config', '--out'].includes(arg)) throw new Error(`不明なオプション: ${arg}`);
      if (options[arg] || !args[i + 1] || args[i + 1].startsWith('-'))
        throw new Error(`${arg} に1つの値が必要です`);
      options[arg] = args[++i];
    } else positional.push(arg);
  }
  if (positional.length > 2 || (positional.length && Object.keys(options).length))
    throw new Error(
      '使用方法: npm run simulate -- <設定.json> <出力先> または --config <設定.json> --out <出力先>',
    );
  const path = options['--config'] ?? positional[0] ?? '',
    out = resolve(options['--out'] ?? positional[1] ?? 'output/default');
  const parsed = path ? JSON.parse(await readFile(resolve(path), 'utf8')) : cloneConfig(),
    config = parsed.config ?? parsed;
  const isLine = config.kind === 'manufacturing-line';
  let result;
  let csvName: string;
  let csv: string;
  if (isLine) {
    validateLineConfig(config);
    result = simulateLine(config);
    csvName = 'events.csv';
    csv = lineEventsCSV(result);
  } else {
    validateConfig(config);
    result = simulate(config);
    csvName = 'trajectory.csv';
    csv = toCSV(result);
  }
  await mkdir(out, { recursive: true });
  await Promise.all([
    writeFile(resolve(out, 'config.json'), JSON.stringify(config, null, 2)),
    writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2)),
    writeFile(resolve(out, csvName), csv),
  ]);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        ...result.summary,
        ...('elapsedMs' in result ? { elapsedMs: Math.round(result.elapsedMs) } : {}),
        output: out,
      },
      null,
      2,
    ),
  );
  if (result.status !== 'OK') process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
