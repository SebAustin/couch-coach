const path = require('path');

/**
 * Tests live in the shared UI package (packages/shared-ui/src/**\/__tests__) and run from this app's `yarn test`.
 * The shared package has no node_modules of its own (Yarn nmHoistingLimits: workspaces), so modules resolve from
 * here; rootDir is the shared package so Jest can instrument its files for coverage.
 */
module.exports = {
  preset: path.dirname(require.resolve('jest-expo/jest-preset')),
  rootDir: path.resolve(__dirname, '../../packages/shared-ui'),
  roots: ['<rootDir>/src'],
  modulePaths: [path.resolve(__dirname, 'node_modules')],
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/{lib,theme,api,navigation,hooks}/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/vendor/**',
  ],
};
