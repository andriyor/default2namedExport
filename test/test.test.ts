import fs from 'fs';

import { beforeAll, describe, it, expect } from 'vitest'

import { migrateToNamedExport } from '../src';

import { prepareTestCases } from './helper';
// fs.cpSync('example', 'example-untouched', {recursive: true});

beforeAll(async () => {
  await migrateToNamedExport({
    projectFiles: 'test/test-project/**/*.{tsx,ts}'
  });
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
