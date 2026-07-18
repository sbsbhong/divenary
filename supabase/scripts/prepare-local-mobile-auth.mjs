import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

import {prepareLocalMobileAuth} from './local-mobile-auth-fixture.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const localSupabaseRunner = path.join(
  repositoryRoot,
  'supabase/scripts/run-local-supabase.mjs',
);

async function readLocalStatus() {
  const {stdout} = await execFileAsync(
    process.execPath,
    [localSupabaseRunner, 'status', '-o', 'json'],
    {cwd: repositoryRoot},
  );

  return JSON.parse(stdout);
}

const result = await prepareLocalMobileAuth({readLocalStatus});
console.log(`Prepared local mobile Auth fixture at ${result.envPath}.`);
