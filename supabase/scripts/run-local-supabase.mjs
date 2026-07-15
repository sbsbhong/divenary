import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
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

const result = spawnSync(supabaseCli, process.argv.slice(2), {
  cwd: repositoryRoot,
  env: localEnvironment,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
