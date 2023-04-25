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

const cwd = process.cwd();

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
        sourceFile.removeDefaultExport();
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

const replaceDefaultImportToNamedImport = (
  importDeclaration: ImportDeclaration,
  names: string[]
) => {
  const namedImports = names.map((name) => {
    return { name };
  });
  importDeclaration.set({
    defaultImport: undefined,
    namedImports: namedImports,
  });
};

const getSourceFilesMap = (sourceFiles: SourceFile[]) => {
  return sourceFiles.reduce((acc, sourceFile) => {
    acc[sourceFile.getFilePath()] = sourceFile;
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

const handleDefaultExportUsage = (
  node: Node,
  currentFilePath: string,
  tsConfigOptions: CompilerOptions,
  pathsWithExports: PathWithExports,
  fixedInFile: string[]
) => {
  if (Node.isExportDeclaration(node)) {
    const moduleSpecifier = node.getModuleSpecifier();
    if (moduleSpecifier) {
      const resolvedFileName = getResolvedFileName(
        moduleSpecifier,
        currentFilePath,
        tsConfigOptions
      );

      if (resolvedFileName) {
        const exportedNames = pathsWithExports[resolvedFileName];

        if (exportedNames) {
          for (const resolvedFileNameElement of node.getNamedExports()) {
            if (Node.isExportSpecifier(resolvedFileNameElement)) {
              const name = resolvedFileNameElement.getName();
              const alias = resolvedFileNameElement.getAliasNode()?.getText();
              const exportedName = exportedNames;

              if (alias) {
                resolvedFileNameElement.setName(exportedName);
                resolvedFileNameElement.removeAliasWithRename();
              }
              if (!alias && name === 'default') {
                resolvedFileNameElement.setName(exportedName);
                pathsWithExports[currentFilePath] = exportedName;
              }
            }
          }
        }
      }
    }
  }

  if (Node.isImportDeclaration(node)) {
    const namedImports = node.getNamedImports();
    const namedImportsNames = namedImports.map((namedImport) => namedImport.getName());

    const moduleSpecifier = node.getModuleSpecifier();
    const resolvedFileName = getResolvedFileName(moduleSpecifier, currentFilePath, tsConfigOptions);

    if (resolvedFileName) {
      // TODO: find better way to fix path
      const fixedPath = resolvedFileName.includes(cwd)
        ? resolvedFileName
        : path.join(cwd, resolvedFileName);
      const exportedName = pathsWithExports[fixedPath];
      if (exportedName && !fixedInFile.includes(fixedPath)) {
        node.renameDefaultImport(exportedName);
        replaceDefaultImportToNamedImport(node, [...namedImportsNames, exportedName]);
        fixedInFile.push(fixedPath);
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
    const pathsWithExports: PathWithExports = {};
    const graphNodesPath = dependencyGraph.nodes.map((node) => path.join(cwd, node.path));
    for (const nodePath of graphNodesPath.reverse()) {
      const sourceFile = sourceFilesMap[nodePath];
      const currentFilePath = sourceFile.getFilePath();

      // TODO: move to single forEachDescendant to improve performance
      // TODO: use ts-morph renaming https://github.com/microsoft/TypeScript/pull/24878
      // TODO: use getDescendantsOfKind
      const defaultExportName = getDefaultExportName(sourceFile);
      if (defaultExportName) {
        sourceFile.forEachDescendant((node) => {
          setIsExportedByDefaultName(node, defaultExportName);
          pathsWithExports[currentFilePath] = defaultExportName;
        });
      }

      // to support mixed imports of same file on next lines
      const fixedInFile: string[] = [];
      sourceFile.forEachDescendant((node) => {
        handleDefaultExportUsage(
          node,
          currentFilePath,
          tsConfig.options,
          pathsWithExports,
          fixedInFile
        );
      });
    }

    // handle files outside of graph
    for (const sourceFile of sourceFiles) {
      const sourceFilePath = sourceFile.getFilePath();
      if (!graphNodesPath.includes(sourceFilePath)) {
        const currentFilePath = sourceFilePath;
        const fixedInFile: string[] = [];
        sourceFile.forEachDescendant((node) => {
          handleDefaultExportUsage(
            node,
            currentFilePath,
            tsConfig.options,
            pathsWithExports,
            fixedInFile
          );
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
//   projectFiles: '**/*.{tsx,ts,js}',
//   start: 'src/pages/balance/index.page.tsx',
// });
