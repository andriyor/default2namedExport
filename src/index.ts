import path from 'path';

import { CompilerOptions, Node, Project, SourceFile, SyntaxKind, ts } from 'ts-morph';
import cliProgress from 'cli-progress';

// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-assignment
const argv: Config = require("yargs-parser")(process.argv.slice(2));

type Config = {
  projectFiles: string;
  workOn?: string;
};

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
        return expression.getText();
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

const getResolvedFileName = (
  moduleName: string,
  containingFile: string,
  tsOptions: CompilerOptions
) => {
  const resolvedModuleName = ts.resolveModuleName(moduleName, containingFile, tsOptions, ts.sys);
  if (resolvedModuleName.resolvedModule?.resolvedFileName) {
    if (resolvedModuleName.resolvedModule.resolvedFileName.includes(process.cwd())) {
      return resolvedModuleName.resolvedModule?.resolvedFileName;
    } else {
      return path.join(process.cwd(), resolvedModuleName.resolvedModule.resolvedFileName);
    }
  }
};

const findRequire = (sourceFile: SourceFile, compilerOptions: CompilerOptions) => {
  const requirePaths: string[] = [];
  const currentFilePath = sourceFile.getFilePath();
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpression) => {
    const expression = callExpression.getExpression();
    if (Node.isIdentifier(expression)) {
      const expressionText = expression.getText();
      if (expressionText === 'require') {
        const firstArgument = callExpression.getArguments()[0];
        if (Node.isStringLiteral(firstArgument)) {
          const moduleName = trimQuotes(firstArgument.getText());
          const filePath = getResolvedFileName(moduleName, currentFilePath, compilerOptions);
          if (filePath) {
            requirePaths.push(filePath);
          }
        }
      }
    }
  });
  return requirePaths;
};

const findLazy = (sourceFile: SourceFile, compilerOptions: CompilerOptions) => {
  const lazyPaths: string[] = [];
  const currentFilePath = sourceFile.getFilePath();
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpression) => {
    const expression = callExpression.getExpression();
    if (Node.isIdentifier(expression)) {
      const expressionText = expression.getText();
      if (expressionText === 'lazy') {
        callExpression
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .forEach((nestedCallExpression) => {
            nestedCallExpression.getArguments().forEach((argument) => {
              if (Node.isStringLiteral(argument)) {
                const moduleName = trimQuotes(argument.getText());
                const resolvedFileName = getResolvedFileName(
                  moduleName,
                  currentFilePath,
                  compilerOptions
                );
                if (resolvedFileName) {
                  lazyPaths.push(resolvedFileName);
                }
              }
            });
          });
      }
    }
  });
  return lazyPaths;
};

export const migrateToNamedExport = (projectFiles: Config) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
  });
  const tsConfig = getTsConfig();

  if (tsConfig) {
    const projectSourceFiles = project.getSourceFiles(projectFiles.projectFiles);
    const sourceFiles = project.getSourceFiles(
      projectFiles.workOn ? projectFiles.workOn : projectFiles.projectFiles
    );
    const sourceFilesWithoutPages = sourceFiles.filter(
      (sourceFile) => !sourceFile.getFilePath().includes('.page.ts')
    );

    console.log('Detect require imports');
    const bar0 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar0.start(projectSourceFiles.length - 1, 0);

    const requirePaths: string[] = [];

    projectSourceFiles.forEach((sourceFile, index) => {
      const requiresInFile = findRequire(sourceFile, tsConfig.options);
      requirePaths.push(...requiresInFile);
      bar0.update(index);
    });
    bar0.stop();

    console.log('Detect lazy imports');
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(projectSourceFiles.length - 1, 0);

    const lazyPaths: string[] = [];

    projectSourceFiles.forEach((sourceFile, index) => {
      const lazyInFile = findLazy(sourceFile, tsConfig.options);
      lazyPaths.push(...lazyInFile);
      bar1.update(index);
    });
    bar1.stop();

    console.log('Convert default export to named export');
    const bar2 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar2.start(sourceFilesWithoutPages.length - 1, 0);

    const fileExport: Record<string, string> = {};

    sourceFilesWithoutPages.forEach((sourceFile, index) => {
      const defaultExportName = getDefaultExportName(sourceFile);
      const filePath = sourceFile.getFilePath();

      if (defaultExportName && !lazyPaths.includes(filePath) && !requirePaths.includes(filePath)) {
        sourceFile.forEachDescendant((node) => {
          setIsExportedByDefaultName(node, defaultExportName);

          if (Node.isExportAssignment(node)) {
            const edits = project
              .getLanguageService()
              .getEditsForRefactor(
                sourceFile,
                {},
                node,
                'Convert export',
                'Convert default export to named export'
              );
            edits?.applyChanges();
          }
        });

        sourceFile
          .getDescendantsOfKind(SyntaxKind.ExportDeclaration)
          .forEach((exportDeclaration) => {
            exportDeclaration.remove();
          });

        fileExport[filePath] = defaultExportName;
      }
      bar2.update(index);
    });
    bar2.stop();

    console.log('Post process usage from index.ts');
    const bar3 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar3.start(projectSourceFiles.length - 1, 0);

    projectSourceFiles.forEach((sourceFile, index) => {
      const currentFilePath = sourceFile.getFilePath();
      sourceFile.getDescendantsOfKind(SyntaxKind.ExportSpecifier).forEach((namedExports) => {
        const name = namedExports.getName();
        const alias = namedExports.getAliasNode()?.getText();
        if (alias === 'default') {
          namedExports
            .getNameNode()
            .findReferencesAsNodes()
            .forEach((node) => {
              if (node.getSourceFile().getFilePath() !== sourceFile.getFilePath()) {
                const parent = node.getParent();
                if (Node.isImportClause(parent)) {
                  const namedImportsNames = parent
                    .getNamedImports()
                    .map((namedImport) => namedImport.getName());
                  const namedImports = [...namedImportsNames, name].map((name) => {
                    return { name };
                  });
                  parent.getParent().renameDefaultImport(name);
                  parent.getParent().set({
                    defaultImport: undefined,
                    namedImports,
                  });
                  fileExport[currentFilePath] = name;
                } else if (Node.isExportSpecifier(parent)) {
                  parent.setName(name);
                  fileExport[currentFilePath] = name;
                }
              }
            });
        }
      });
      bar3.update(index);
    });
    bar3.stop();

    console.log('Remove aliases with rename');
    const bar4 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar4.start(projectSourceFiles.length - 1, 0);

    projectSourceFiles.forEach((sourceFile, index) => {
      const currentFilePath = sourceFile.getFilePath();
      sourceFile.getDescendantsOfKind(SyntaxKind.ExportDeclaration).forEach((exportDeclaration) => {
        const moduleSpecifier = exportDeclaration.getModuleSpecifier();
        if (moduleSpecifier) {
          const moduleName = trimQuotes(moduleSpecifier.getText());
          const resolvedFileName = getResolvedFileName(
            moduleName,
            currentFilePath,
            tsConfig.options
          );
          if (resolvedFileName && Object.keys(fileExport).includes(resolvedFileName)) {
            exportDeclaration.getNamedExports().forEach((exportSpecifier) => {
              exportSpecifier.removeAliasWithRename();
            });
          }
        }
      });

      sourceFile.getDescendantsOfKind(SyntaxKind.ImportDeclaration).forEach((importDeclaration) => {
        const importDeclarationPath = importDeclaration
          .getModuleSpecifierSourceFile()
          ?.getFilePath();
        if (!importDeclarationPath?.includes('node_modules')) {
          for (const namedImports of importDeclaration.getNamedImports()) {
            if (Node.isImportSpecifier(namedImports)) {
              const moduleSpecifier = importDeclaration.getModuleSpecifier();
              const moduleName = trimQuotes(moduleSpecifier.getText());
              const resolvedFileName = getResolvedFileName(
                moduleName,
                currentFilePath,
                tsConfig.options
              );
              if (resolvedFileName && Object.keys(fileExport).includes(resolvedFileName)) {
                namedImports.removeAliasWithRename();
              }
            }
          }
        }
      });
      bar4.update(index);
    });
    bar4.stop();

    console.log('Handle jest.mock default');
    const bar5 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar5.start(projectSourceFiles.length - 1, 0);

    projectSourceFiles.forEach((sourceFile, index) => {
      const currentFilePath = sourceFile.getFilePath();
      sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpression) => {
        const expression = callExpression.getExpression();
        if (Node.isPropertyAccessExpression(expression)) {
          const propExpression = expression.getExpression();
          if (Node.isIdentifier(propExpression)) {
            const expressionName = expression.getName();
            const propExpressionText = propExpression.getText();
            if (propExpressionText === 'jest' && expressionName === 'mock') {
              const firstArg = callExpression.getArguments()[0];

              if (Node.isStringLiteral(firstArg)) {
                const moduleName = trimQuotes(firstArg.getText());
                const resolvedFileName = getResolvedFileName(
                  moduleName,
                  currentFilePath,
                  tsConfig.options
                );
                if (resolvedFileName && fileExport[resolvedFileName]) {
                  callExpression
                    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
                    .forEach((propertyAssignment) => {
                      const name = propertyAssignment.getName();
                      if (name === 'default') {
                        propertyAssignment.rename(fileExport[resolvedFileName]);
                      }
                    });

                  callExpression
                    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
                    .forEach((returnStatement) => {
                      const expression = returnStatement.getExpression();
                      if (Node.isArrowFunction(expression)) {
                        expression.replaceWithText(
                          `{ ${fileExport[resolvedFileName]}: ${expression.getText()} }`
                        );
                      }
                    });
                }
              }
            }
          }
        }
      });
      bar5.update(index);
    });
    bar5.stop();

    return project.save();
  }
};

if (argv.projectFiles) {
  migrateToNamedExport({
    projectFiles: argv.projectFiles,
    workOn: argv?.workOn || ''
  });
}

// migrateToNamedExport({
//   projectFiles: '{src,test}/**/*.{tsx,ts,js}',
//   workOn: 'src/components/form/**/*.{tsx,ts,js}',
// })
