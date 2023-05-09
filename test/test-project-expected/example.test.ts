jest.mock('./src/components/main/Input', () => {
  return {
    __esModule: true,
    Input: () => '',
  };
});
