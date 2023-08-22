# default2namedExport

## Supported

- [x] Import from file with `export default` under different name
- [x] Index file with `export { default } from './module';`
- [x] Index file with multiple `export { default as method } from './module';`
- [x] Import from index file under different name
- [x] Handle mixed imports `import COmponent, { Props } from './component';`
- [x] Partial migrate by glob pattern
- [x] Handle jest.mock with default property
- [x] Handle jest.mock without default property
- [x] Handle lazy import
- [x] Ignore files which will be required
- [x] Run as CLI
- [ ] Run "Convert 'require' to 'import'"
- [ ] Save previous imports with alias
- [ ] Publish npm package

## CLI

```shell
npx tsx src/index.ts --project-files='{src,test}/**/*.{tsx,ts,js}' --work-on='src/components/form/**/*.{tsx,ts,js}'
```

## API

```ts
import { migrateToNamedExport } from '../src';

migrateToNamedExport({
  projectFiles: '{src,test}/**/*.{tsx,ts,js}',
  workOn: 'src/components/form/**/*.{tsx,ts,js}',
});
```
