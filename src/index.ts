import {
  CompilerOptions,
  Node,
  Project,
  SourceFile,
  StringLiteral,
  SyntaxKind,
  ts,
} from 'ts-morph';
import cliProgress from 'cli-progress';

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
  moduleSpecifier: StringLiteral,
  containingFile: string,
  tsOptions: CompilerOptions
) => {
  const moduleName = trimQuotes(moduleSpecifier.getText());
  const resolvedModuleName = ts.resolveModuleName(moduleName, containingFile, tsOptions, ts.sys);
  return resolvedModuleName.resolvedModule?.resolvedFileName;
};

export const migrateToNamedExport = (projectFiles: Config) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
  });
  const tsConfig = getTsConfig();
  const processedFiles: string[] = [];

  if (tsConfig) {
    const sourceFiles = project.getSourceFiles(
      projectFiles.workOn ? projectFiles.workOn : projectFiles.projectFiles
    );
    const sourceFilesWithoutPages = sourceFiles.filter(
      (sourceFile) => !sourceFile.getFilePath().includes('.page.ts')
    );

    console.log('Convert default export to named export');
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(sourceFilesWithoutPages.length - 1, 0);

    sourceFilesWithoutPages.forEach((sourceFile, index) => {
      const defaultExportName = getDefaultExportName(sourceFile);

      if (defaultExportName) {
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
      }
      processedFiles.push(sourceFile.getFilePath());
      bar1.update(index);
    });
    bar1.stop();

    const projectSourceFiles = project.getSourceFiles(projectFiles.projectFiles);

    console.log('Post process usage from index.ts');
    const bar2 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar2.start(projectSourceFiles.length - 1, 0);

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
                  processedFiles.push(currentFilePath);
                } else if (Node.isExportSpecifier(parent)) {
                  parent.setName(name);
                  processedFiles.push(currentFilePath);
                }
              }
            });
        }
      });
      bar2.update(index);
    });
    bar2.stop();

    console.log('Remove aliases with rename');
    const bar3 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar3.start(projectSourceFiles.length - 1, 0);

    projectSourceFiles.forEach((sourceFile, index) => {
      const currentFilePath = sourceFile.getFilePath();
      sourceFile.getDescendantsOfKind(SyntaxKind.ExportDeclaration).forEach((exportDeclaration) => {
        const moduleSpecifier = exportDeclaration.getModuleSpecifier();
        if (moduleSpecifier) {
          const resolvedFileName = getResolvedFileName(
            moduleSpecifier,
            currentFilePath,
            tsConfig.options
          );
          if (resolvedFileName && processedFiles.includes(resolvedFileName)) {
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
              const resolvedFileName = getResolvedFileName(
                moduleSpecifier,
                currentFilePath,
                tsConfig.options
              );
              if (resolvedFileName && processedFiles.includes(resolvedFileName)) {
                namedImports.removeAliasWithRename();
              }
            }
          }
        }
      });
      bar3.update(index);
    });
    bar3.stop();

    return project.save();
  }
};

// migrateToNamedExport('test/test-project/**/*.ts');

migrateToNamedExport({
  projectFiles: '{src,test}/**/*.{tsx,ts,js}',
  workOn: 'src/components/pay-links/**/*.{tsx,ts,js}',
});
