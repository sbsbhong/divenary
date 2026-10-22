import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, '..');
const schemaPath = path.join(packageDir, 'schemas', 'watch-sync-message.schema.json');
const outputPath = path.join(packageDir, 'generated', 'swift', 'WatchContracts.swift');

await mkdir(path.dirname(outputPath), { recursive: true });

await runQuicktype('WatchSyncMessage', schemaPath, outputPath);
console.log(`Generated Swift contracts: ${path.relative(packageDir, outputPath)}`);

const linkSchemaPath = path.join(packageDir, 'schemas', 'watch-link-messages.schema.json');
const linkOutputPath = path.join(packageDir, 'generated', 'swift', 'WatchLinkContracts.swift');
await runQuicktype('WatchLinkMessage', linkSchemaPath, linkOutputPath);
console.log(`Generated Swift contracts: ${path.relative(packageDir, linkOutputPath)}`);

const plannedDiveSchemaPath = path.join(packageDir, 'schemas', 'watch-planned-dive.schema.json');
const plannedDiveOutputPath = path.join(packageDir, 'generated', 'swift', 'WatchPlannedDiveContract.swift');
await runQuicktype('WatchPlannedDive', plannedDiveSchemaPath, plannedDiveOutputPath);
console.log(`Generated Swift contracts: ${path.relative(packageDir, plannedDiveOutputPath)}`);

function runQuicktype(topLevel, source, output) {
  const args = [
    '--src-lang',
    'schema',
    '--lang',
    'swift',
    '--top-level',
    topLevel,
    '--access-level',
    'public',
    '--swift-5-support',
    '--acronym-style',
    'original',
    '--src',
    source,
    '--out',
    output
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('quicktype', args, { stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`quicktype exited with code ${code ?? 'unknown'}`));
    });
  });
}
