import path from 'path';
import process from 'process';

import {
  Project,
  Node,
  SourceFile,
  ImportDeclaration,
  CompilerOptions,
  StringLiteral,
} from 'ts-morph';
import ts from 'typescript';
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

const setIsExportedByDefaultName = (node: Node, defaultExportName: string) => {
  if (Node.isVariableStatement(node)) {
    for (const declarations of node.getDeclarations()) {
      const varName = declarations.getName();
      if (defaultExportName === varName) {
        node.setIsExported(true);
      }
    }
  }
  if (Node.isTypeAliasDeclaration(node)) {
    const typeName = node.getName();
    if (defaultExportName === typeName) {
      node.setIsExported(true);
    }
  }
};

const replaceDefaultImportToNamedImport = (importDeclaration: ImportDeclaration, name: string) => {
  importDeclaration.set({
    defaultImport: undefined,
    namedImports: [
      {
        name,
      },
    ],
  });
};

const getSourceFilesMap = (project: Project, config: Config) => {
  const sourceFiles = project.getSourceFiles(config.projectFiles);

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

const getResolvedFileName = (
  moduleSpecifier: StringLiteral,
  containingFile: string,
  tsOptions: CompilerOptions
) => {
  const moduleName = trimQuotes(moduleSpecifier.getText());
  const resolvedModuleName = ts.resolveModuleName(moduleName, containingFile, tsOptions, ts.sys);
  return resolvedModuleName.resolvedModule?.resolvedFileName;
};

type Config = {
  projectFiles: string;
  start: string;
};

export const migrateToNamedExport = (config: Config) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    // skipAddingFilesFromTsConfig: true,
    // skipFileDependencyResolution: true,
  });

  const sourceFilesMap = getSourceFilesMap(project, config);
  const tsConfig = getTsConfig();
  const dependencyGraph = getDependencyGraph(config);

  if (tsConfig) {
    // TODO: change structure to separate index file with many exports and file with single export default?
    const pathsWithExports: Record<string, Record<string, string>[]> = {};
    const renamedImport: Record<string, string> = {};

    for (const node of dependencyGraph.nodes.reverse()) {
      const sourceFile = sourceFilesMap[node.path];
      const currentFilePath: string = sourceFile.getFilePath();

      const defaultExportName = getDefaultExportName(sourceFile);
      if (defaultExportName) {
        sourceFile.forEachDescendant((node) => {
          setIsExportedByDefaultName(node, defaultExportName);
          pathsWithExports[currentFilePath] = [{ [defaultExportName]: defaultExportName }];
        });
      }

      sourceFile.forEachDescendant((node) => {
        if (Node.isExportDeclaration(node)) {
          const moduleSpecifier = node.getModuleSpecifier();
          if (moduleSpecifier) {
            const resolvedFileName = getResolvedFileName(
              moduleSpecifier,
              currentFilePath,
              tsConfig.options
            );

            if (resolvedFileName) {
              const exportedNames = pathsWithExports[resolvedFileName];

              if (exportedNames) {
                for (const resolvedFileNameElement of node.getNamedExports()) {
                  if (Node.isExportSpecifier(resolvedFileNameElement)) {
                    const name = resolvedFileNameElement.getName();
                    const alias = resolvedFileNameElement.getAliasNode()?.getText() || name;
                    const exportedName = Object.keys(exportedNames[0])[0];
                    const aliasKey = alias === 'default' ? exportedName : alias;

                    if (aliasKey !== exportedName) {
                      renamedImport[aliasKey] = exportedName;
                    }

                    if (name === 'default' && exportedName) {
                      resolvedFileNameElement.set({ name: exportedName, alias: undefined });
                      if (pathsWithExports[currentFilePath]) {
                        pathsWithExports[currentFilePath].push({ [aliasKey]: exportedName });
                      } else {
                        pathsWithExports[currentFilePath] = [{ [aliasKey]: exportedName }];
                      }
                    }
                  }
                }
              }
            }
          }
        }

        if (Node.isImportDeclaration(node)) {
          let importedAsName = '';
          const importClauseText = node.getImportClause()?.getText() || '';
          const namedImports = node.getNamedImports().map((element) => element.getName());
          if (namedImports.length) {
            importedAsName = namedImports[0];
          } else {
            importedAsName = importClauseText;
          }

          const moduleSpecifier = node.getModuleSpecifier();

          const resolvedFileName = getResolvedFileName(
            moduleSpecifier,
            currentFilePath,
            tsConfig.options
          );

          if (resolvedFileName) {
            const exportedNames = pathsWithExports[resolvedFileName];
            if (exportedNames) {
              const exportedName = exportedNames.find((name) => name[importedAsName]);
              if (importedAsName) {
                if (exportedName) {
                  replaceDefaultImportToNamedImport(node, exportedName[importedAsName]);
                } else {
                  // to handle renamed import
                  const exportedName = Object.keys(exportedNames[0])[0];
                  replaceDefaultImportToNamedImport(node, exportedName);
                  renamedImport[importedAsName] = exportedName;
                }
              }
            }
          }
        }

        // use named export name instead of renamed default
        // TODO: optimize
        if (Node.isIdentifier(node) && !Node.isImportSpecifier(node.getParent())) {
          const identifierText = node.getText();
          const originName = renamedImport[identifierText];
          if (originName && typeof originName === 'string') {
            // TODO: use rename?
            // 1) rename default export
            // 2) change to named export
            node.replaceWithText(originName);
          }
        }
      });
    }
  }

  return project.save();
};

// migrateToNamedExport({
//   projectFiles: 'test/test-project/**/*.ts',
//   start: 'test/test-project/A-usage.ts',
// });

// migrateToNamedExport({
//   projectFiles: 'src/**/*.{tsx,ts,js}',
//   start: 'src/pages/balance/index.page.tsx',
// });
