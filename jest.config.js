module.exports = {
  projects: [
    {
      // Unit tests for app code, in the React Native environment.
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
      testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.'],
    },
    {
      // App code talking real HTTP to the mock server. Plain Node, so fetch/FormData are real.
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.integration.test.ts'],
      transform: { '\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
    },
    {
      displayName: 'server',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/server/**/*.test.js'],
    },
  ],
};
