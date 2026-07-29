import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  ONBOARDING_RPC_METADATA_COMMAND,
  STAGING_PROJECT_REF,
  assertStagingProjectRef,
  buildStagingLegalSql,
  buildStagingEnvironment,
  readStagingPromotionCommit,
} from './staging-project.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const projectRefPath = path.join(repositoryRoot, 'supabase/.temp/project-ref');
const supabaseCli = path.join(repositoryRoot, 'node_modules/.bin/supabase');

function isExactCommand(arguments_, expected) {
  return arguments_.length === expected.length &&
    arguments_.every((argument, index) => argument === expected[index]);
}

async function assertAllowedStagingCommand(arguments_) {
  const allowedCommands = [
    ['link', '--project-ref', STAGING_PROJECT_REF],
    ['migration', 'list', '--linked'],
    ['db', 'push', '--linked', '--dry-run'],
    ['db', 'push', '--linked'],
    [
      'functions',
      'deploy',
      'finalize-guest-claim',
      '--project-ref',
      STAGING_PROJECT_REF,
    ],
    ONBOARDING_RPC_METADATA_COMMAND,
  ];

  const isLegalSeedQuery =
    arguments_.length === 5 &&
    arguments_[0] === 'db' &&
    arguments_[1] === 'query' &&
    arguments_[2] === '--linked' &&
    arguments_[3] === '--file' &&
    path.isAbsolute(arguments_[4]);

  if (!allowedCommands.some(command => isExactCommand(arguments_, command)) && !isLegalSeedQuery) {
    throw new Error('Refusing an unsupported staging Supabase command.');
  }

  if (isLegalSeedQuery) {
    const sql = await readFile(arguments_[4], 'utf8');
    if (sql !== buildStagingLegalSql(readStagingPromotionCommit())) {
      throw new Error('Refusing a staging SQL file that is not the current legal seed.');
    }
  }
}

async function assertLinkIsSafe(arguments_, {projectRefExists, readProjectRef}) {
  if (arguments_[0] !== 'link') {
    await assertStagingProjectRef({readProjectRef});
    return;
  }

  if (!(await projectRefExists())) {
    return;
  }

  await assertStagingProjectRef({readProjectRef});
}

export async function runStagingSupabase(arguments_, {
  spawnSyncImpl = spawnSync,
  environment = process.env,
  stdio = 'inherit',
  encoding,
  projectRefExists = () => existsSync(projectRefPath),
  readProjectRef = () => readFile(projectRefPath, 'utf8'),
} = {}) {
  await assertAllowedStagingCommand(arguments_);
  await assertLinkIsSafe(arguments_, {projectRefExists, readProjectRef});

  const result = spawnSyncImpl(supabaseCli, arguments_, {
    cwd: repositoryRoot,
    env: buildStagingEnvironment(environment),
    stdio,
    encoding,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return result;
  }

  if (arguments_[0] === 'link') {
    await assertStagingProjectRef({readProjectRef});
  }

  return result;
}

async function main() {
  await runStagingSupabase(process.argv.slice(2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
