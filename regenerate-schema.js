#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { buildClientSchema, printSchema, getIntrospectionQuery } = require('graphql');
const config = require('./config');

// Configuration
const { SCHEMA_URL, SCHEMA_DIR, SCHEMA_FILE, API_KEY, ENVIRONMENT } = config;

// Colors for output
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m'; // No Color

console.log(`${YELLOW}Regenerating Healthie GraphQL schema for environment: ${ENVIRONMENT}...${NC}`);

// Create schema directory if it doesn't exist
if (!fs.existsSync(SCHEMA_DIR)) {
    fs.mkdirSync(SCHEMA_DIR, { recursive: true });
}

const introspectionQuery = getIntrospectionQuery();

const postData = JSON.stringify({
    query: introspectionQuery
});

const url = new URL(SCHEMA_URL);
const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

// Add API key headers if present
if (API_KEY) {
    options.headers['authorization'] = `Basic ${API_KEY}`;
    options.headers['AuthorizationSource'] = 'API';
}

console.log('Fetching schema from Healthie API...');

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const result = JSON.parse(data);
            if (result.errors) {
                console.error(`${RED}GraphQL errors:${NC}`, result.errors);
                process.exit(1);
            }
            
            const schema = buildClientSchema(result.data);
            const sdl = printSchema(schema);
            
            fs.writeFileSync(SCHEMA_FILE, sdl);
            console.log(`${GREEN}✓ Schema downloaded and converted to SDL format successfully${NC}`);
            console.log(`${GREEN}✓ Schema saved to: ${SCHEMA_FILE}${NC}`);
            
            // Save introspection result for reference
            const introspectionFile = ENVIRONMENT === 'default' 
                ? 'introspection-result.json' 
                : `introspection-result-${ENVIRONMENT}.json`;
            fs.writeFileSync(path.join(SCHEMA_DIR, introspectionFile), JSON.stringify(result, null, 2));
        } catch (error) {
            console.error(`${RED}Failed to process schema:${NC}`, error.message);
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error(`${RED}Request failed:${NC}`, error.message);
    process.exit(1);
});

req.write(postData);
req.end();