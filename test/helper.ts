import path from 'path';

import { globSync } from 'glob';

const zip = (rows: string[][]) =>
  rows[0].map((_, c) => rows.map((row) => row[c]));

const getProjectFilesByPath = (projectPath: string) => {
  return globSync(`${projectPath}/**`, {
    stat: true,
    withFileTypes: true,
  })
    .filter((path) => !path.isDirectory())
    .map((filePath) => path.relative(process.cwd(), filePath.fullpath()));
};

export const prepareTestCases = () => {
  const testProjectFiles = getProjectFilesByPath('test/test-project');
  const testProjectFilesExpected = getProjectFilesByPath(
    'test/test-project-expected'
  );
  return zip([testProjectFiles, testProjectFilesExpected]);
};
