import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { harness } from './harness.js';

export async function connect(
    app: ReturnType<typeof harness>['app'],
    token?: string
) {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
        new StreamableHTTPClientTransport(new URL('http://local/mcp'), {
            fetch: async (url, init) => app.request(String(url), init),
            requestInit: token
                ? { headers: { authorization: `Bearer ${token}` } }
                : {}
        })
    );
    return client;
}

export async function call(client: Client, name: string, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { type: string; text: string }[];
    return JSON.parse(content?.text ?? 'null');
}
