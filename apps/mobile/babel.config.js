const fs = require('fs');
const path = require('path');

const loadDevelopmentEnv = () => {
  const envPath = path.resolve(__dirname, '.env.development');

  if (!fs.existsSync(envPath)) {
    return {};
  }

  return fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        return env;
      }

      const separatorIndex = trimmed.indexOf('=');

      if (separatorIndex === -1) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      env[key] = value.replace(/^["']|["']$/g, '');
      return env;
    }, {});
};

const env = loadDevelopmentEnv();

const inlineMobileEnvPlugin = ({ types: t }) => ({
  visitor: {
    Identifier(identifierPath) {
      if (identifierPath.node.name === '__OPEN_METEO_API_KEY__') {
        identifierPath.replaceWith(t.stringLiteral(env.OPEN_METEO_API_KEY ?? ''));
      }
    },
  },
});

module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    '@babel/plugin-transform-class-static-block',
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
          'tailwind.config': './tailwind.config.js',
        },
      },
    ],
    inlineMobileEnvPlugin,
    'react-native-worklets/plugin',
  ],
};
