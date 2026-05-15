module.exports = {
    testEnvironment: 'node',
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
      'controllers/**/*.js',
      'services/**/*.js',
      'utils/**/*.js',
      'middleware/**/*.js',
      '!**/node_modules/**'
    ],
    testMatch: [
      '**/tests/**/*.test.js'
    ],
    coverageThreshold: {
      global: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70
      }
    },
    testTimeout: 30000,
    verbose: true,
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true
  };