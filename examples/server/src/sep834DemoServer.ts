/**
 * SEP-834 Demo Server
 *
 * Demonstrates the loosened JSON Schema restrictions proposed in SEP-834:
 * - inputSchema: Can be any valid JSON Schema (not just type: "object")
 * - outputSchema: Can be any valid JSON Schema (array, primitive, etc.)
 * - structuredContent: Can be any JSON value (array, primitive, not just object)
 */

import type { CallToolResult } from '@modelcontextprotocol/server';
import { createMcpExpressApp, McpServer, StreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';
import * as z from 'zod/v4';

// Mock data for demonstration
const USERS = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com' }
];

const RESOURCES = [
    { id: 'res-001', name: 'database', type: 'storage' },
    { id: 'res-002', name: 'cache', type: 'memory' },
    { id: 'res-003', name: 'queue', type: 'messaging' }
];

const getServer = () => {
    const server = new McpServer(
        {
            name: 'sep-834-demo-server',
            version: '1.0.0'
        },
        { capabilities: { logging: {} } }
    );

    // ============================================================
    // Tool 1: list_users - Demonstrates ARRAY output schema (SEP-834)
    // ============================================================
    server.registerTool(
        'list_users',
        {
            description: 'Returns a list of all users. Demonstrates array output schema (SEP-834).',
            inputSchema: {
                // Standard object input with no required parameters
            },
            outputSchema: {
                // SEP-834: Array type at root level (previously not allowed)
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'User ID' },
                        name: { type: 'string', description: 'User name' },
                        email: { type: 'string', description: 'User email' }
                    },
                    required: ['id', 'name', 'email']
                }
            }
        },
        async (): Promise<CallToolResult> => {
            // SEP-834: structuredContent can now be an array
            const structuredContent = USERS;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(structuredContent, null, 2)
                    }
                ],
                structuredContent
            };
        }
    );

    // ============================================================
    // Tool 2: find_resource - Demonstrates composition input schema (SEP-834)
    // ============================================================
    server.registerTool(
        'find_resource',
        {
            description: 'Find a resource by ID or name. Demonstrates oneOf composition in inputSchema (SEP-834).',
            inputSchema: {
                // SEP-834: Using oneOf composition (previously required single object with type: "object")
                oneOf: [
                    {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Resource ID to look up' }
                        },
                        required: ['id'],
                        additionalProperties: false
                    },
                    {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Resource name to look up' }
                        },
                        required: ['name'],
                        additionalProperties: false
                    }
                ]
            },
            outputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    type: { type: 'string' }
                },
                required: ['id', 'name', 'type']
            }
        },
        async (args): Promise<CallToolResult> => {
            const input = args as { id?: string; name?: string };

            let resource;
            if (input.id) {
                resource = RESOURCES.find(r => r.id === input.id);
            } else if (input.name) {
                resource = RESOURCES.find(r => r.name === input.name);
            }

            if (!resource) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Resource not found'
                        }
                    ],
                    isError: true
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(resource, null, 2)
                    }
                ],
                structuredContent: resource
            };
        }
    );

    // ============================================================
    // Tool 3: count_items - Demonstrates primitive output schema (SEP-834)
    // ============================================================
    server.registerTool(
        'count_items',
        {
            description: 'Returns the count of items. Demonstrates primitive (number) output schema (SEP-834).',
            inputSchema: {
                collection: z.enum(['users', 'resources']).describe('Which collection to count')
            },
            outputSchema: {
                // SEP-834: Primitive type at root level (previously not allowed)
                type: 'number',
                description: 'The count of items in the collection'
            }
        },
        async ({ collection }): Promise<CallToolResult> => {
            const count = collection === 'users' ? USERS.length : RESOURCES.length;

            // SEP-834: structuredContent can now be a primitive value
            return {
                content: [
                    {
                        type: 'text',
                        text: `${count}`
                    }
                ],
                structuredContent: count
            };
        }
    );

    // ============================================================
    // Tool 4: get_status - Traditional object output (backward compatibility)
    // ============================================================
    server.registerTool(
        'get_status',
        {
            description: 'Returns server status. Demonstrates traditional object output (backward compatible).',
            inputSchema: {
                // No parameters needed
            },
            outputSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
                    uptime: { type: 'number', description: 'Uptime in seconds' },
                    version: { type: 'string' }
                },
                required: ['status', 'uptime', 'version']
            }
        },
        async (): Promise<CallToolResult> => {
            const statusData = {
                status: 'healthy' as const,
                uptime: Math.floor(process.uptime()),
                version: '1.0.0'
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(statusData, null, 2)
                    }
                ],
                structuredContent: statusData
            };
        }
    );

    return server;
};

// Create Express app
const app = createMcpExpressApp();

// Handle MCP requests
app.post('/mcp', async (req: Request, res: Response) => {
    const server = getServer();
    try {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            console.log('Request closed');
            transport.close();
            server.close();
        });
    } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error'
                },
                id: null
            });
        }
    }
});

// Reject other methods
app.get('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
    }));
});

app.delete('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
    }));
});

// Start the server
const PORT = 3834; // Using 3834 to reference SEP-834
app.listen(PORT, error => {
    if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    SEP-834 Demo Server                       ║
╠══════════════════════════════════════════════════════════════╣
║  Listening on: http://localhost:${PORT}/mcp                    ║
║                                                              ║
║  Available tools demonstrating SEP-834 features:             ║
║  • list_users     - Array output schema                      ║
║  • find_resource  - Composition input schema (oneOf)         ║
║  • count_items    - Primitive output schema (number)         ║
║  • get_status     - Traditional object output                ║
╚══════════════════════════════════════════════════════════════╝
`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down SEP-834 demo server...');
    process.exit(0);
});
