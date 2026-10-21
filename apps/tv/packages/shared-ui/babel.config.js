// Used only by Jest (rootDir = this package, see apps/expo-multi-tv/jest.config.js); Metro uses the app's config.
const path = require('path');

module.exports = {
  presets: [require.resolve('babel-preset-expo', { paths: [path.resolve(__dirname, '../../apps/expo-multi-tv')] })],
};
