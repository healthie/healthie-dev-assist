#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const config = require('./config');

// Load environment variables from .env file
require('dotenv').config();

const { SCHEMA_URL, SCHEMA_DIR, SCHEMA_FILE, MCP_SERVER_PATH, API_KEY, ENVIRONMENT } = config;

// Convert relative paths to absolute paths
const absoluteSchemaFile = path.resolve(__dirname, SCHEMA_FILE);
const absoluteMcpServerPath = path.resolve(__dirname, MCP_SERVER_PATH);

// MCP protocol implementation for search tool
class MCPSearchWrapper {
    constructor() {
        this.schemaContent = null;
        this.mcpProcess = null;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
    }

    async initialize() {
        // Load schema into memory for searching
        this.schemaContent = fs.readFileSync(absoluteSchemaFile, 'utf8');
        
        // Start the actual MCP server
        this.startMCPServer();
        
        // Handle incoming messages
        this.rl.on('line', (line) => {
            try {
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch (e) {
                // If it's not JSON, it might be a message for the underlying MCP server
                if (this.mcpProcess && this.mcpProcess.stdin) {
                    this.mcpProcess.stdin.write(line + '\n');
                }
            }
        });
    }

    startMCPServer() {
        // Build command arguments
        const args = ['--introspection', '--schema', absoluteSchemaFile, '--endpoint', SCHEMA_URL];
        
        // Add API key header if present
        if (API_KEY) {
            args.push('--header', `authorization: Basic ${API_KEY}`);
            args.push('--header', `AuthorizationSource: API`);
        }

        // Start the MCP server
        this.mcpProcess = spawn(absoluteMcpServerPath, args, { 
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: __dirname
        });

        // Buffer for accumulating output
        let outputBuffer = '';
        
        // Forward stdout from MCP server to our stdout
        this.mcpProcess.stdout.on('data', (data) => {
            outputBuffer += data.toString();
            
            // Try to process complete JSON messages
            let lines = outputBuffer.split('\n');
            outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const message = JSON.parse(line);
                    
                    // Validate it's a JSON-RPC message
                    if (!message.jsonrpc && !message.method && !message.id) {
                        // Not a JSON-RPC message, log to stderr
                        process.stderr.write(`[MCP Server]: ${line}\n`);
                        continue;
                    }
                    
                    // Intercept and modify the tools list if it's a tools response
                    if (message.result && message.result.tools) {
                        // Find and modify the introspect tool description
                        const introspectTool = message.result.tools.find(tool => tool.name === 'introspect');
                        if (introspectTool) {
                            introspectTool.description = 'Get detailed information about types from the GraphQL schema. Use the type name `Query` to get root query fields. IMPORTANT: Use the search_schema tool FIRST to find queries, mutations, and types before using introspect for details.';
                        }
                        
                        // Add our search schema tool
                        const envSuffix = ENVIRONMENT !== 'default' ? ` (Environment: ${ENVIRONMENT})` : '';
                        message.result.tools.push({
                            name: 'search_schema',
                            description: `Search the GraphQL schema for types, fields, queries, or mutations${envSuffix}. ALWAYS USE THIS FIRST when looking for available queries, mutations, or types. This is much more efficient than using introspect to browse the entire schema.`,
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    query: {
                                        type: 'string',
                                        description: 'Search query (supports regex)'
                                    },
                                    type: {
                                        type: 'string',
                                        enum: ['type', 'query', 'mutation', 'input', 'enum', 'interface', 'union', 'scalar', 'any'],
                                        description: 'Type of schema element to search for (default: any)'
                                    },
                                    context_lines: {
                                        type: 'number',
                                        description: 'Number of context lines to show around matches (default: 5)'
                                    }
                                },
                                required: ['query']
                            }
                        });
                    }
                    process.stdout.write(JSON.stringify(message) + '\n');
                } catch (e) {
                    // Not JSON or invalid JSON, log to stderr instead of stdout
                    if (line.trim()) {
                        process.stderr.write(`[MCP Server]: ${line}\n`);
                    }
                }
            }
        });

        // Forward stderr
        this.mcpProcess.stderr.on('data', (data) => {
            process.stderr.write(data);
        });

        this.mcpProcess.on('error', (err) => {
            console.error('MCP server error:', err);
            process.exit(1);
        });

        this.mcpProcess.on('close', (code) => {
            // Process any remaining buffer
            if (outputBuffer && outputBuffer.trim()) {
                try {
                    const message = JSON.parse(outputBuffer);
                    if (message.jsonrpc || message.method || message.id) {
                        process.stdout.write(JSON.stringify(message) + '\n');
                    }
                } catch (e) {
                    // Log any remaining non-JSON to stderr
                    process.stderr.write(`[MCP Server]: ${outputBuffer}\n`);
                }
            }
            process.exit(code || 0);
        });
    }

    handleMessage(message) {
        // Check if this is a call to our search tool
        if (message.method === 'tools/call' && 
            message.params && 
            message.params.name === 'search_schema') {
            
            this.handleSearchSchema(message);
        } else if (message.method === 'tools/call' && 
                   message.params && 
                   message.params.name === 'introspect') {
            
            // Intercept introspect calls to block general Query/Mutation introspection
            const typeName = message.params.arguments?.type_name;
            if (typeName === 'Query' || typeName === 'Mutation') {
                const errorResponse = {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32603,
                        message: `Direct introspection of '${typeName}' type is not allowed. Please use the search_schema tool to find specific queries or mutations, then introspect individual types for details.`
                    }
                };
                process.stdout.write(JSON.stringify(errorResponse) + '\n');
                return;
            }
            
            // Forward allowed introspect calls to the underlying MCP server
            if (this.mcpProcess && this.mcpProcess.stdin) {
                this.mcpProcess.stdin.write(JSON.stringify(message) + '\n');
            }
        } else {
            // Forward to the underlying MCP server
            if (this.mcpProcess && this.mcpProcess.stdin) {
                this.mcpProcess.stdin.write(JSON.stringify(message) + '\n');
            }
        }
    }

    handleSearchSchema(message) {
        const { query, type = 'any', context_lines = 5 } = message.params.arguments;
        
        try {
            const results = this.searchSchema(query, type, context_lines);
            
            const response = {
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    content: [
                        {
                            type: 'text',
                            text: results
                        }
                    ]
                }
            };
            
            process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
            const errorResponse = {
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
            
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
    }

    searchSchema(query, type, contextLines) {
        const lines = this.schemaContent.split('\n');
        const regex = new RegExp(query, 'gi');
        const matches = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line matches the type filter
            if (type !== 'any') {
                const typePattern = new RegExp(`^(type|input|enum|interface|union|scalar)\\s+`, 'i');
                const isDefinition = typePattern.test(line.trim());
                
                if (isDefinition) {
                    const lineType = line.trim().split(/\s+/)[0].toLowerCase();
                    if (type === 'query' || type === 'mutation') {
                        // For query/mutation, we need to look inside Query/Mutation types
                        continue;
                    } else if (lineType !== type) {
                        continue;
                    }
                }
            }
            
            // Check if the line matches the search query
            if (regex.test(line)) {
                // Get context lines
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length - 1, i + contextLines);
                const context = [];
                
                for (let j = start; j <= end; j++) {
                    const prefix = j === i ? '>>> ' : '    ';
                    context.push(`${j + 1}:${prefix}${lines[j]}`);
                }
                
                matches.push({
                    lineNumber: i + 1,
                    line: line.trim(),
                    context: context.join('\n')
                });
            }
        }
        
        // Special handling for query/mutation search
        if (type === 'query' || type === 'mutation') {
            const typeMatches = this.searchForQueryMutation(query, type, contextLines);
            matches.push(...typeMatches);
        }
        
        if (matches.length === 0) {
            return `No matches found for "${query}"${type !== 'any' ? ` in ${type} definitions` : ''}`;
        }
        
        let result = `Found ${matches.length} matches for "${query}"${type !== 'any' ? ` in ${type} definitions` : ''}:\n\n`;
        
        for (const match of matches.slice(0, 20)) { // Limit to 20 results
            result += `Line ${match.lineNumber}: ${match.line}\n`;
            result += `Context:\n${match.context}\n\n`;
            result += '---\n\n';
        }
        
        if (matches.length > 20) {
            result += `\n... and ${matches.length - 20} more matches. Refine your search for more specific results.`;
        }
        
        return result;
    }

    searchForQueryMutation(query, type, contextLines) {
        const lines = this.schemaContent.split('\n');
        const matches = [];
        const regex = new RegExp(query, 'gi');
        
        // Find the Query or Mutation type block
        let inTargetType = false;
        let braceCount = 0;
        const targetType = type.charAt(0).toUpperCase() + type.slice(1);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!inTargetType && line.trim().startsWith(`type ${targetType}`)) {
                inTargetType = true;
                continue;
            }
            
            if (inTargetType) {
                // Count braces to track when we exit the type
                for (const char of line) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
                
                if (braceCount === 0 && line.includes('}')) {
                    inTargetType = false;
                    continue;
                }
                
                // Check if this line matches the query
                if (regex.test(line) && line.trim() !== '' && !line.trim().startsWith('#')) {
                    const start = Math.max(0, i - contextLines);
                    const end = Math.min(lines.length - 1, i + contextLines);
                    const context = [];
                    
                    for (let j = start; j <= end; j++) {
                        const prefix = j === i ? '>>> ' : '    ';
                        context.push(`${j + 1}:${prefix}${lines[j]}`);
                    }
                    
                    matches.push({
                        lineNumber: i + 1,
                        line: line.trim(),
                        context: context.join('\n')
                    });
                }
            }
        }
        
        return matches;
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    if (wrapper.mcpProcess) {
        wrapper.mcpProcess.kill('SIGINT');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (wrapper.mcpProcess) {
        wrapper.mcpProcess.kill('SIGTERM');
    }
    process.exit(0);
});

// Start the wrapper
const wrapper = new MCPSearchWrapper();
wrapper.initialize().catch(err => {
    console.error('Failed to initialize MCP wrapper:', err);
    process.exit(1);
});