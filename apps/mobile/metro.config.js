const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');
const {
  createMetroEnvironmentConfig,
} = require('./scripts/create-metro-environment-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  ...createMetroEnvironmentConfig(),
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    unstable_enablePackageExports: false,
  },
};

module.exports = withNativeWind(mergeConfig(getDefaultConfig(__dirname), config), {
  input: './global.css',
  inlineRem: 16,
});
