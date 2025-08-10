module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Optional: specify roots if your tests are not at the root or in __tests__
  // roots: ['<rootDir>/src'], // or wherever your .ts files are
  // Optional: transform property might be needed if you have specific babel presets alongside ts-jest, but preset should handle most cases.
  // transform: {
  //   '^.+\.tsx?$': 'ts-jest',
  // },
  // Optional: setupFilesAfterEnv for setting up test environment
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // if you have a setup file
};
