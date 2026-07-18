const {
  createMobileEnvironmentCacheVersion,
  loadMobileEnvironment,
} = require('./load-mobile-env');

const createMetroEnvironmentConfig = options => {
  const mobileEnvironment = loadMobileEnvironment(options);

  return {
    cacheVersion: createMobileEnvironmentCacheVersion(mobileEnvironment),
  };
};

module.exports = {createMetroEnvironmentConfig};
