import path from 'node:path';

// Both clients must launch the same server against the same explicit profile.
export function mcpServerConfig({ node, root, directory }) {
  return {
    command: node,
    args: [path.resolve(root, 'src/mcp/server.mjs')],
    env: { WORKROOM_DATA_DIR: path.resolve(directory) },
  };
}
