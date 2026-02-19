/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Separate prompt tests — they call the real Claude API and cost money
  testPathIgnorePatterns: ['/node_modules/', '/tests/prompts/'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server/index.js', // Entry point — covered by integration tests
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  // Give Claude API calls room to breathe in the rare case mocks leak
  testTimeout: 10000,
};
