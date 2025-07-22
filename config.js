const { getMCPServerPath } = require('./utils');

module.exports = {
  SCHEMA_URL: 'https://staging-api.gethealthie.com/graphql',
  SCHEMA_DIR: './schemas',
  SCHEMA_FILE: './schemas/healthie-schema.graphql',
  MCP_SERVER_PATH: getMCPServerPath()
};