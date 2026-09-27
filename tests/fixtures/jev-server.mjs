// Contract fixture only. No dependency on a Jev checkout or real user data.
import { readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const filename = process.argv[2];
const mode = process.argv[3];
const server = new McpServer({ name: 'jev-contract-fixture', version: '1' });
const contract = 'workroom-jev/1';
const read = () => {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch {
    return [];
  }
};
const response = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
server.registerTool('bridge_status', { inputSchema: { contract: z.string() } }, async () => {
  if (mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 20000));
  return response({
    contract: mode === 'version' ? 'workroom-jev/2' : contract,
    workspaceId: 'fixture-workspace',
    workspaceRoot: process.cwd(),
    capabilities: ['publish', 'search'],
  });
});
const scope = { contract: z.string(), originId: z.string(), productId: z.string() };
server.registerTool(
  'bridge_publish',
  {
    inputSchema: {
      ...scope,
      reportId: z.string(),
      revision: z.number(),
      title: z.string(),
      summary: z.string(),
      contribution: z.string(),
      limitations: z.string(),
    },
  },
  async (args) => {
    const rows = read();
    const key = (x) => `${x.originId}/${x.productId}/${x.reportId}`;
    const i = rows.findIndex((x) => key(x) === key(args));
    if (
      i >= 0 &&
      (rows[i].revision > args.revision ||
        (rows[i].revision === args.revision && JSON.stringify(rows[i]) !== JSON.stringify(args)))
    )
      return { isError: true, content: [{ type: 'text', text: 'revision_conflict' }] };
    const status = i < 0 ? 'created' : rows[i].revision === args.revision ? 'unchanged' : 'updated';
    if (i < 0) rows.push(args);
    else rows[i] = args;
    writeFileSync(filename, JSON.stringify(rows));
    return response({
      contract,
      status,
      memoryId: 'memory-' + args.reportId,
      revision: args.revision,
    });
  },
);
server.registerTool(
  'bridge_search',
  { inputSchema: { ...scope, query: z.string(), limit: z.number() } },
  async (args) => {
    const rows = read().filter(
      (x) =>
        x.originId === args.originId &&
        x.productId === args.productId &&
        `${x.title} ${x.summary}`.includes(args.query),
    );
    return response({
      contract,
      items: rows.slice(0, args.limit).map((x) => ({
        memoryId: 'memory-' + x.reportId,
        reportId: x.reportId,
        revision: x.revision,
        title: x.title,
        summary: x.summary,
        contribution: x.contribution,
        limitations: x.limitations,
      })),
      truncated: rows.length > args.limit,
    });
  },
);
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => process.exit(0));
