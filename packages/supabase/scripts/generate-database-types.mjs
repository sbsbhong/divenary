import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(packageRoot, '../..');
const outputPath = path.join(packageRoot, 'src', 'database.types.ts');
const supabaseCli = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  'supabase',
);
const localEnvironment = {...process.env};

for (const name of [
  'PINTERNET_SUPABASE_PROJECT_ID',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_ID',
]) {
  delete localEnvironment[name];
}

const result = spawnSync(
  supabaseCli,
  ['gen', 'types', 'typescript', '--local', '--schema', 'public'],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: localEnvironment,
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.status !== 0) {
  if (result.stdout) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  throw new Error('Supabase database type generation failed');
}

const normalized = `${result.stdout.trimEnd()}\n`;

if (!normalized.startsWith('export type Json')) {
  throw new Error('Supabase database type generation returned unexpected output');
}

const current = existsSync(outputPath)
  ? readFileSync(outputPath, 'utf8')
  : undefined;

if (current !== normalized) {
  writeFileSync(outputPath, normalized, 'utf8');
}
