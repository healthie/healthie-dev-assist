const fs = require('fs');
const path = require('path');

function getEnvironmentConfig() {
  const environmentsFile = path.join(__dirname, 'environments.json');
  const selectedEnv = process.env.HEALTHIE_ENV;
  
  // If no HEALTHIE_ENV specified or no environments.json file, use default
  if (!selectedEnv || !fs.existsSync(environmentsFile)) {
    return {
      endpoint: 'https://staging-api.gethealthie.com/graphql',
      apiKey: process.env.HEALTHIE_API_KEY,
      schemaFile: './schemas/healthie-schema.graphql'
    };
  }
  
  // Load environments configuration
  try {
    const environments = JSON.parse(fs.readFileSync(environmentsFile, 'utf8'));
    
    if (!environments[selectedEnv]) {
      throw new Error(`Environment "${selectedEnv}" not found in environments.json`);
    }
    
    const envConfig = environments[selectedEnv];
    return {
      endpoint: envConfig.endpoint,
      apiKey: envConfig.apiKey,
      schemaFile: `./schemas/healthie-schema-${selectedEnv}.graphql`
    };
  } catch (error) {
    console.error('Error loading environment configuration:', error.message);
    process.exit(1);
  }
}

const envConfig = getEnvironmentConfig();

module.exports = {
  SCHEMA_URL: envConfig.endpoint,
  SCHEMA_DIR: './schemas',
  SCHEMA_FILE: envConfig.schemaFile,
  MCP_SERVER_PATH: './apollo-mcp-server',
  API_KEY: envConfig.apiKey,
  ENVIRONMENT: process.env.HEALTHIE_ENV || 'default'
};