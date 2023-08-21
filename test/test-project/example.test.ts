jest.mock('./src/components/main/Input', () => {
  return {
    __esModule: true,
    default: () => '',
  };
});

jest.mock('./src/components/main/Input', () => {
  return () => '';
});
