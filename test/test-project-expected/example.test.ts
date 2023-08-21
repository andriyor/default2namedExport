jest.mock('./src/components/main/Input', () => {
  return {
    __esModule: true,
    Input: () => '',
  };
});

jest.mock('./src/components/main/Input', () => {
  return { Input: () => '' }
});
