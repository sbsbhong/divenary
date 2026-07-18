const {createHash} = require('crypto');
const fs = require('fs');
const path = require('path');

const defaultDevelopmentEnvPath = path.resolve(
  __dirname,
  '../.env.development',
);
const defaultLocalEnvPath = path.resolve(__dirname, '../.env.local');
const developmentBabelEnvironments = new Set(['development', 'test']);
const inlineMobileEnvironmentKeys = [
  'MOBILE_ENVIRONMENT_MODE',
  'OPEN_METEO_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANDROID_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'LOCAL_AUTH_EMAIL',
  'LOCAL_AUTH_PASSWORD',
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_IOS_CLIENT_ID',
];
const developmentConfigurationKeys = inlineMobileEnvironmentKeys.filter(
  key => key !== 'MOBILE_ENVIRONMENT_MODE',
);
const mobileEnvironmentModes = new Set(['local', 'staging', 'release']);

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

const resolveMobileEnvironmentMode = ({
  environment,
  isDevelopmentBuild,
}) => {
  if (!isDevelopmentBuild) {
    return 'release';
  }

  const requestedMode = environment.MOBILE_ENVIRONMENT;

  if (requestedMode === undefined || requestedMode === '') {
    return 'staging';
  }

  if (!mobileEnvironmentModes.has(requestedMode)) {
    throw new Error('Invalid MOBILE_ENVIRONMENT configuration');
  }

  return requestedMode;
};

const loadMobileEnvironment = (options = {}) => {
  const environment = options.environment ?? process.env;
  const babelEnvironment = options.babelEnvironment ?? process.env.BABEL_ENV;
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  const developmentEnvPath =
    options.developmentEnvPath ?? defaultDevelopmentEnvPath;
  const localEnvPath = options.localEnvPath ?? defaultLocalEnvPath;
  const effectiveBabelEnvironment =
    babelEnvironment ?? nodeEnvironment ?? 'development';
  const isDevelopmentBuild =
    developmentBabelEnvironments.has(effectiveBabelEnvironment) &&
    (nodeEnvironment === undefined ||
      developmentBabelEnvironments.has(nodeEnvironment));
  const mobileEnvironmentMode = resolveMobileEnvironmentMode({
    environment,
    isDevelopmentBuild,
  });
  const selectedDevelopmentEnvPath =
    mobileEnvironmentMode === 'local'
      ? localEnvPath
      : developmentEnvPath;
  const developmentEnvironment =
    isDevelopmentBuild && mobileEnvironmentMode !== 'release'
      ? loadDevelopmentEnvironment(selectedDevelopmentEnvPath)
      : {};
  const processEnvironment = toStringEnvironment(environment);

  if (!isDevelopmentBuild || mobileEnvironmentMode === 'release') {
    for (const key of developmentConfigurationKeys) {
      delete processEnvironment[key];
    }
  }

  return {
    ...developmentEnvironment,
    ...processEnvironment,
    MOBILE_ENVIRONMENT_MODE: mobileEnvironmentMode,
  };
};

const createMobileEnvironmentCacheVersion = environment => {
  const selectedInlineEnvironment = inlineMobileEnvironmentKeys.map(key => [
    key,
    typeof environment[key] === 'string' ? environment[key] : '',
  ]);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(selectedInlineEnvironment))
    .digest('hex');

  return `mobile-environment-v1-${fingerprint}`;
};

module.exports = {
  createMobileEnvironmentCacheVersion,
  inlineMobileEnvironmentKeys,
  loadMobileEnvironment,
};
