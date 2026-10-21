import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverUnitTests} from './run-unit-tests.mjs';

test('unit discovery includes every direct test file in stable order, not helpers or directories', t => {
  const directory = mkdtempSync(join(tmpdir(), 'akis-unit-discovery-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const name of ['z.test.mjs', 'a.test.mjs', 'helper.mjs', 'test.txt']) writeFileSync(join(directory, name), '');
  mkdirSync(join(directory, 'folder.test.mjs'));
  assert.deepEqual(discoverUnitTests(directory), [join(directory, 'a.test.mjs'), join(directory, 'z.test.mjs')]);
});

test('unit discovery refuses a missing or empty suite instead of reporting success', t => {
  const directory = mkdtempSync(join(tmpdir(), 'akis-unit-discovery-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  assert.throws(() => discoverUnitTests(directory), /No unit test files/);
  assert.throws(() => discoverUnitTests(join(directory, 'missing')), {code: 'ENOENT'});
});
