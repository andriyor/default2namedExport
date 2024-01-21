import fs from 'node:fs';
import childProcess from 'node:child_process';
import util from 'node:util';

import { beforeAll, describe, it, expect, afterAll } from 'vitest'

import { migrateToNamedExport } from '../src';
import { prepareTestCases } from './helper';
import path from 'path';

const exec = util.promisify(childProcess.exec);

beforeAll(async () => {
  await migrateToNamedExport({
    projectFiles: path.join(__dirname, 'test-project/**/*.{tsx,ts}')
  });
});

afterAll(async () => {
  await exec('git stash push -- test/test-project');
});

describe('default-export', () => {
  const testCases = prepareTestCases();
  it.each(testCases)(
    'module %s should be the same as %s module',
    (actual, expected) => {
      const methodFile = fs.readFileSync(actual, 'utf-8');
      const expectedMethodFile = fs.readFileSync(expected, 'utf-8');
      expect(methodFile).toEqual(expectedMethodFile);
    }
  );
});
