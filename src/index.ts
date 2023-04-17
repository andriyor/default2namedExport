import path from 'path';
import process from 'process';

import { Project, Node, ts, SourceFile, ImportDeclaration } from 'ts-morph';
import { GraphOptions } from 'ts_dependency_graph';
import * as lib from 'ts_dependency_graph/dist/lib';

export const trimQuotes = (str: string) => {
  return str.slice(1, -1);
};

const getTsConfig = () => {
  const tsConfigFilePath = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  if (tsConfigFilePath) {
    const configFile = ts.readConfigFile(tsConfigFilePath, ts.sys.readFile);
    return ts.parseJsonConfigFileContent(configFile.config, ts.sys, '');
  }
};

const getDefaultExportName = (sourceFile: SourceFile) => {
  const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
  if (defaultExportSymbol) {
    const defaultExportDeclaration = defaultExportSymbol.getDeclarations()[0];
    if (Node.isExportAssignment(defaultExportDeclaration)) {
      const expression = defaultExportDeclaration.getExpression();
      if (Node.isIdentifier(expression)) {
        const defaultExportName = expression.getText();
        defaultExportDeclaration.remove();
        return defaultExportName;
      }
    }
  }
};

const addExportToVariable = (node: Node, defaultExportName: string) => {
  if (Node.isVariableStatement(node)) {
    for (const declarations of node.getDeclarations()) {
      const varName = declarations.getName();
      if (defaultExportName === varName) {
        node.setIsExported(true);
      }
    }
  }
};

const replaceDefaultImportToNamedImport = (
  node: ImportDeclaration,
  name: string
) => {
  node.set({
    defaultImport: undefined,
    namedImports: [
      {
        kind: 17,
        name,
        alias: undefined,
        isTypeOnly: false,
      },
    ],
  });
};

const getSourceFilesMap = (project: Project) => {
  const sourceFiles = project.getSourceFiles('test-project/**/*.ts');

  return sourceFiles.reduce((acc, sourceFile) => {
    acc[path.relative(process.cwd(), sourceFile.getFilePath())] = sourceFile;
    return acc;
  }, {} as Record<string, SourceFile>);
};

const getDependencyGraph = (config: Config) => {
  const options: GraphOptions = {
    start: config.start,
    graph_folder: false,
  };

  return lib.get_graph(options);
};

type Config = {
  start: string;
};

export const migrateToNamedExport = (config: Config) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    // skipAddingFilesFromTsConfig: true,
    // skipFileDependencyResolution: true,
  });

  const sourceFilesMap = getSourceFilesMap(project);
  const tsConfig = getTsConfig();
  const dependencyGraph = getDependencyGraph(config);

  if (tsConfig) {
    const pathsWithExports: Record<string, string> = {};

    for (const node of dependencyGraph.nodes.reverse()) {
      const sourceFile = sourceFilesMap[node.path];
      const currentFilePath = sourceFile.getFilePath();

      const defaultExportName = getDefaultExportName(sourceFile);
      if (defaultExportName) {
        sourceFile.forEachDescendant((node) => {
          addExportToVariable(node, defaultExportName);
          pathsWithExports[currentFilePath] = defaultExportName;
        });
      }

      const renamedImport: Record<string, string> = {};
      sourceFile.forEachDescendant((node) => {
        if (Node.isImportDeclaration(node)) {
          const importText = trimQuotes(node.getModuleSpecifier().getText());
          const importedAsName = node.getImportClause()?.getText();
          const moduleName = ts.resolveModuleName(
            importText,
            currentFilePath,
            tsConfig.options,
            ts.sys
          );
          const resolvedFileName = moduleName.resolvedModule?.resolvedFileName;
          if (resolvedFileName) {
            const importName = pathsWithExports[resolvedFileName];
            if (importedAsName) {
              replaceDefaultImportToNamedImport(node, importName);
              if (importedAsName !== importName) {
                renamedImport[importedAsName] = importName;
              }
            }
          }
        }

        if (
          Node.isIdentifier(node) &&
          !Node.isImportSpecifier(node.getParent())
        ) {
          const identifierText = node.getText();
          const originName = renamedImport[identifierText];
          if (originName) {
            node.replaceWithText(originName);
          }
        }
      });
    }
  }

  return project.save();
};

// migrateToNamedExport({
//   start: 'test/test-project/A-usage.ts',
// });
