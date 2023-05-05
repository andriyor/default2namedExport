# default2namedExport

## Supported

- [x] Basic example with alphabetical order
- [x] import graph resolution
- [x] imported from file with `export default`  with different name
- [x] index file with `export { default } from './module';`
- [x] index file with multiple `export { default as method } from './module';`
- [x] imported from index file with `export { default as method } from './module';`  with different name
- [x] paths in `tsconfig.json`
- [x] fix usage outside of graph
- [x] handle mixed imports `import COmponent, { Props } from './component';`
- [ ] run as CLI
- [ ] add mixed import test
- [ ] add renamed Button import test
- [ ] lazy import
- [ ] save previous imports with alias
- [ ] progress bar and stats
- [ ] fix jest.mock
