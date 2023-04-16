import process from 'process';

import { Project, Node, ts, SourceFile, ImportDeclaration } from 'ts-morph';

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

export const migrateToNamedExport = () => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
  });

  const sourceFiles = project.getSourceFiles('test-project/**/*.ts');

  const tsConfig = getTsConfig();

  if (tsConfig) {
    const pathsWithExports: Record<string, string> = {};

    for (const sourceFile of sourceFiles) {
      const currentFilePath = sourceFile.getFilePath();

      const defaultExportName = getDefaultExportName(sourceFile);
      if (defaultExportName) {
        sourceFile.forEachDescendant((node) => {
          addExportToVariable(node, defaultExportName);
          pathsWithExports[currentFilePath] = defaultExportName;
        });
      }

      sourceFile.forEachDescendant((node) => {
        if (Node.isImportDeclaration(node)) {
          const importText = trimQuotes(node.getModuleSpecifier().getText());
          const moduleName = ts.resolveModuleName(
            importText,
            currentFilePath,
            tsConfig.options,
            ts.sys
          );
          const resolvedFileName = moduleName.resolvedModule?.resolvedFileName;
          if (resolvedFileName) {
            const importName = pathsWithExports[resolvedFileName];
            if (importName) {
              replaceDefaultImportToNamedImport(node, importName);
            }
          }
        }
      });
    }
  }

  return project.save();
};

// migrateToNamedExport();
