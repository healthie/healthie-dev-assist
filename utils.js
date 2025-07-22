const path = require('path');
const fs = require('fs');
const which = require('which');

function getBinaryName() {
  return process.platform === 'win32' ? 'apollo-mcp-server.exe' : 'apollo-mcp-server';
}

function getLocalBinaryPath() {
  return path.resolve(__dirname, './bin', getBinaryName());
}

function binaryExistsLocally() {
  try {
    fs.accessSync(getLocalBinaryPath(), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function binaryExistsInPath() {
  try {
    which.sync(getBinaryName());
    return true;
  } catch {
    return false;
  }
}

function getMCPServerPath() {
  const localPath = getLocalBinaryPath();
  
  if (binaryExistsLocally()) {
    return localPath;
  }
  
  if (binaryExistsInPath()) {
    return which.sync(getBinaryName());
  }
  
  return getBinaryName();
}

module.exports = {
  getBinaryName,
  getLocalBinaryPath,
  binaryExistsLocally,
  binaryExistsInPath,
  getMCPServerPath
};