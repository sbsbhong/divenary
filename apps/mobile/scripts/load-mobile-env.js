const fs = require('fs');
const path = require('path');

const defaultDevelopmentEnvPath = path.resolve(
  __dirname,
  '../.env.development',
);

const parseEnvironmentFile = source =>
  source.split(/\r?\n/).reduce((environment, line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return environment;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      return environment;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key) {
      environment[key] = value.replace(/^(["'])(.*)\1$/, '$2');
    }

    return environment;
  }, {});

const loadDevelopmentEnvironment = developmentEnvPath => {
  if (!fs.existsSync(developmentEnvPath)) {
    return {};
  }

  return parseEnvironmentFile(fs.readFileSync(developmentEnvPath, 'utf8'));
};

const toStringEnvironment = environment =>
  Object.entries(environment).reduce((result, [key, value]) => {
    if (typeof value === 'string') {
      result[key] = value;
    }

    return result;
  }, {});

const loadMobileEnvironment = (options = {}) => {
  const environment = options.environment ?? process.env;
  const babelEnvironment = options.babelEnvironment ?? process.env.BABEL_ENV;
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  const developmentEnvPath =
    options.developmentEnvPath ?? defaultDevelopmentEnvPath;
  const isProduction =
    babelEnvironment === 'production' || nodeEnvironment === 'production';
  const developmentEnvironment = isProduction
    ? {}
    : loadDevelopmentEnvironment(developmentEnvPath);

  return {
    ...developmentEnvironment,
    ...toStringEnvironment(environment),
  };
};

module.exports = {loadMobileEnvironment};
