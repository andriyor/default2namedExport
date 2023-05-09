# default2namedExport

## Supported

- [x] import from file with `export default`  under different name
- [x] index file with `export { default } from './module';`
- [x] index file with multiple `export { default as method } from './module';`
- [x] import from index file under different name
- [x] handle mixed imports `import COmponent, { Props } from './component';`
- [x] partial migrate by glob pattern
- [x] handle jest.mock with default property
- [x] handle jest.mock without default property
- [ ] run as CLI
- [ ] handle lazy import
- [ ] save previous imports with alias
