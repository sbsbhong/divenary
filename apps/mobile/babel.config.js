const {loadMobileEnvironment} = require('./scripts/load-mobile-env');

const environmentIdentifiers = {
  __OPEN_METEO_API_KEY__: 'OPEN_METEO_API_KEY',
  __SUPABASE_URL__: 'SUPABASE_URL',
  __SUPABASE_PUBLISHABLE_KEY__: 'SUPABASE_PUBLISHABLE_KEY',
  __GOOGLE_WEB_CLIENT_ID__: 'GOOGLE_WEB_CLIENT_ID',
  __GOOGLE_IOS_CLIENT_ID__: 'GOOGLE_IOS_CLIENT_ID',
};

const createInlineMobileEnvironmentPlugin = environment =>
  function inlineMobileEnvironmentPlugin({types: t}) {
    return {
      visitor: {
        Identifier(identifierPath) {
          const identifierName = identifierPath.node.name;

          if (!Object.hasOwn(environmentIdentifiers, identifierName)) {
            return;
          }

          const environmentKey = environmentIdentifiers[identifierName];

          if (
            !identifierPath.isReferencedIdentifier() ||
            identifierPath.scope.hasBinding(identifierName)
          ) {
            return;
          }

          identifierPath.replaceWith(
            t.stringLiteral(environment[environmentKey] ?? ''),
          );
        },
      },
    };
  };

module.exports = api => {
  const babelEnvironment = api.env();
  const environment = loadMobileEnvironment({babelEnvironment});

  return {
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
      createInlineMobileEnvironmentPlugin(environment),
      'react-native-worklets/plugin',
    ],
  };
};
