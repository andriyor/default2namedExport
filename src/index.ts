import path from 'path';
import process from 'process';

import ts from 'typescript';
import {
  Project,
  Node,
  SourceFile,
  ImportDeclaration,
  CompilerOptions,
  StringLiteral,
} from 'ts-morph';
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

const getSourceFilesMap = (sourceFiles: SourceFile[]) => {
  return sourceFiles.reduce((acc, sourceFile) => {
    // TODO: change graph paths instead of source file to improve performance
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

type PathWithExports = Record<string, string>;

const handleImport = (
  node: Node,
  currentFilePath: string,
  tsConfigOptions: CompilerOptions,
  pathsWithExports: PathWithExports,
) => {
  if (Node.isImportDeclaration(node)) {
    const namedImports = node.getNamedImports();

    const moduleSpecifier = node.getModuleSpecifier();
    const resolvedFileName = getResolvedFileName(moduleSpecifier, currentFilePath, tsConfigOptions);

    if (resolvedFileName) {
      const exportedName = pathsWithExports[resolvedFileName];
      if (exportedName) {
        if (!namedImports.length) {
          node.renameDefaultImport(exportedName);
          replaceDefaultImportToNamedImport(node, exportedName);
        }
      }
    }
  }
};

export const migrateToNamedExport = (config: Config) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    // skipAddingFilesFromTsConfig: true,
    // skipFileDependencyResolution: true,
  });

  const sourceFiles = project.getSourceFiles(config.projectFiles);
  const sourceFilesMap = getSourceFilesMap(sourceFiles);
  const tsConfig = getTsConfig();
  const dependencyGraph = getDependencyGraph(config);

  if (tsConfig) {
    // TODO: change structure to separate index file with many exports and file with single export default?
    const pathsWithExports: PathWithExports = {};

    const graphNodes = dependencyGraph.nodes.map((node) => node.path).reverse();
    for (const nodePath of graphNodes) {
      const sourceFile = sourceFilesMap[nodePath];
      const currentFilePath = sourceFile.getFilePath();

      // TODO: move to single forEachDescendant to improve performance
      // TODO: use ts-morph renaming
      const defaultExportName = getDefaultExportName(sourceFile);
      if (defaultExportName) {
        sourceFile.forEachDescendant((node) => {
          setIsExportedByDefaultName(node, defaultExportName);
          pathsWithExports[currentFilePath] = defaultExportName;
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
                    const alias = resolvedFileNameElement.getAliasNode()?.getText();
                    const exportedName = exportedNames;

                    if (alias) {
                      resolvedFileNameElement.setName(exportedName);
                      resolvedFileNameElement.removeAliasWithRename();
                    } else {
                      resolvedFileNameElement.setName(exportedName);
                      pathsWithExports[currentFilePath] = exportedName;
                    }
                  }
                }
              }
            }
          }
        }

        handleImport(node, currentFilePath, tsConfig.options, pathsWithExports);
      });
    }

    const graphNodesAbsolute = graphNodes.map((nodePath) => path.join(process.cwd(), nodePath));
    for (const sourceFile of sourceFiles) {
      if (!graphNodesAbsolute.includes(sourceFile.getFilePath())) {
        const currentFilePath = sourceFile.getFilePath();

        sourceFile.forEachDescendant((node) => {
          handleImport(node, currentFilePath, tsConfig.options, pathsWithExports);
        });
      }
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
