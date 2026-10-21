import {readdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptFile), '..');

export function discoverUnitTests(directory) {
  const files = readdirSync(directory, {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => resolve(directory, entry.name))
    .sort();
  if (!files.length) throw new Error('No unit test files found.');
  return files;
}

// Expand test paths in Node, not the shell, so Windows and Unix run the same suite.
if (process.argv[1] && resolve(process.argv[1]) === scriptFile) {
  try {
    const files = discoverUnitTests(resolve(projectRoot, 'scripts'));
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
