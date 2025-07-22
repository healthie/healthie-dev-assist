#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { getBinaryName, getLocalBinaryPath, binaryExistsLocally, binaryExistsInPath } = require('./utils');

const execAsync = promisify(exec);


const INSTALL_COMMANDS = {
    win32: "powershell -Command \"iwr 'https://mcp.apollo.dev/download/win/latest' | iex\"",
    default: 'curl -sSL https://mcp.apollo.dev/download/nix/latest | sh'
};

async function installApollo() {
    const installCmd = INSTALL_COMMANDS[process.platform] || INSTALL_COMMANDS.default;
    const binaryName = getBinaryName();
    const localBinary = getLocalBinaryPath();
    
    try {
        // Check if binary exists locally first
        if (binaryExistsLocally()) {
            console.log('Apollo MCP Server already installed');
            return;
        }
        
        // Check if binary exists in system PATH
        if (binaryExistsInPath()) {
            console.log('Apollo MCP Server already installed in PATH');
            return;
        }
        
        console.log('Installing Apollo MCP Server...');
        await execAsync(installCmd);
        
        // Move binary to local bin directory if it was installed in project root
        const rootBinary = path.resolve(__dirname, binaryName);
        if (fs.existsSync(rootBinary)) {
            const localBinDir = path.dirname(localBinary);
            fs.mkdirSync(localBinDir, { recursive: true });
            fs.renameSync(rootBinary, localBinary);
            console.log('Installation successful');
        } else if (binaryExistsInPath()) {
            console.log('Installation successful');
        } else {
            console.log('Binary not found - restart terminal or check installation');
        }
    } catch (error) {
        console.error(`Installation failed: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    installApollo();
}

module.exports = { installApollo };