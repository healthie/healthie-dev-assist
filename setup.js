#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');

// Load environment variables from .env file
require('dotenv').config();

const { SCHEMA_URL, SCHEMA_DIR, SCHEMA_FILE, MCP_SERVER_PATH, ENVIRONMENT } = config;

// Convert relative paths to absolute paths
const absoluteSchemaDir = path.resolve(__dirname, SCHEMA_DIR);
const absoluteSchemaFile = path.resolve(__dirname, SCHEMA_FILE);

// Create schema directory if it doesn't exist
if (!fs.existsSync(absoluteSchemaDir)) {
    fs.mkdirSync(absoluteSchemaDir, { recursive: true });
}

// Check if schema file exists
if (!fs.existsSync(absoluteSchemaFile)) {
    
    // Use the regenerate-schema script
    const regenerate = spawn('node', [path.resolve(__dirname, 'regenerate-schema.js')], { 
        stdio: 'inherit',
        cwd: __dirname
    });
    
    regenerate.on('close', (code) => {
        if (code !== 0) {
            process.exit(1);
        }
        startMCPWithSearch();
    });
} else {
    startMCPWithSearch();
}

function startMCPWithSearch() {
    // Start the MCP wrapper with search functionality
    const wrapperPath = path.resolve(__dirname, 'mcp-with-search.js');
    
    const server = spawn('node', [wrapperPath], { 
        stdio: 'inherit',
        cwd: __dirname
    });

    server.on('error', (err) => {
        console.error('Failed to start MCP server with search:', err);
        process.exit(1);
    });

    server.on('close', (code) => {
        process.exit(code || 0);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        server.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
        server.kill('SIGTERM');
    });
}