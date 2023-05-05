import { Node, Project, SourceFile, SyntaxKind } from 'ts-morph';

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

export const migrateToNamedExport = (projectFiles: string) => {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
  });

  const sourceFiles = project.getSourceFiles(projectFiles);
  const sourceFilesWithoutPages = sourceFiles.filter(
    (sourceFile) => !sourceFile.getFilePath().includes('.page.ts')
  );

  for (const sourceFile of sourceFilesWithoutPages) {
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

      sourceFile.getDescendantsOfKind(SyntaxKind.ExportDeclaration).forEach((exportDeclaration) => {
        exportDeclaration.remove();
      });
    }
  }

  for (const sourceFile of sourceFiles) {
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
              } else if (Node.isExportSpecifier(parent)) {
                parent.setName(name);
              }
            }
          });
      }
    });
  }

  for (const sourceFile of sourceFiles) {
    sourceFile.getDescendantsOfKind(SyntaxKind.ExportSpecifier).forEach((exportSpecifier) => {
      exportSpecifier.removeAliasWithRename();
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.ImportDeclaration).forEach((importDeclaration) => {
      const importDeclarationPath = importDeclaration.getModuleSpecifierSourceFile()?.getFilePath();
      if (!importDeclarationPath?.includes('node_modules')) {
        for (const namedImports of importDeclaration.getNamedImports()) {
          if (Node.isImportSpecifier(namedImports)) {
            namedImports.removeAliasWithRename();
          }
        }
      }
    });
  }

  return project.save();
};

// migrateToNamedExport('test/test-project/**/*.ts');

// migrateToNamedExport('**/{src,test}/**/*.{tsx,ts,js}');
