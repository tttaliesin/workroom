import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { ControlError, failure } from './contracts.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const clientSession = randomUUID();
// auth.* is excluded from agent reads and source copies, even with a custom data directory.
const endpointFile = (directory) => path.join(directory, 'auth.control.json');
const address = (directory) => {
  const identity =
    process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  const key = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\workroom-${key}`
    : path.join(directory, 'control.sock');
};
const validToken = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function listenControl(directory, handler) {
  await mkdir(directory, { recursive: true });
  const endpoint = address(directory),
    token = randomBytes(32).toString('hex');
  // The desktop instance lock is held by the caller; a Unix socket left by a crashed owner is stale.
  if (process.platform !== 'win32') await rm(endpoint, { force: true });
  const server = net.createServer((socket) => {
    let buffer = '',
      bytes = 0,
      handled = false;
    socket.setEncoding('utf8');
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async (chunk) => {
      if (handled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) return socket.destroy();
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      handled = true;
      try {
        const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (!validToken(message.token, token))
          throw new Error('Local control authentication failed.');
        const value = await handler(
          { action: message.action, input: message.input },
          {
            channel: 'mcp',
            sessionId:
              typeof message.sessionId === 'string' && /^[a-f0-9-]{36}$/.test(message.sessionId)
                ? message.sessionId
                : 'local-client',
          },
        );
        const response = JSON.stringify({ ok: true, value }) + '\n';
        if (Buffer.byteLength(response) > MAX_BYTES)
          throw new Error('Response too large. Read fewer entities or a specific entity ID.');
        socket.end(response);
      } catch (error) {
        socket.end(JSON.stringify({ ok: false, error: failure(error) }) + '\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  if (process.platform !== 'win32') await chmod(endpoint, 0o600);
  const temporary = endpointFile(directory) + '.next';
  await writeFile(temporary, JSON.stringify({ protocol: 1, token, pid: process.pid }), {
    mode: 0o600,
  });
  await rename(temporary, endpointFile(directory));
  return server;
}

export async function controlRequest(directory, action, input = {}) {
  let config;
  try {
    config = JSON.parse(await readFile(endpointFile(directory), 'utf8'));
  } catch {
    throw new ControlError(
      'EXECUTOR_OFFLINE',
      'Workroom executor is offline or an older app is running. Use workroom_control_connect with start:true, or restart the old app.',
    );
  }
  if (config.protocol !== 1 || typeof config.token !== 'string')
    throw new ControlError(
      'PROTOCOL_MISMATCH',
      'Unsupported Workroom control endpoint. Restart the updated app.',
    );
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address(directory));
    let text = '',
      size = 0;
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(
        typeof message === 'object'
          ? new ControlError(message.code, message.message, message.details)
          : new ControlError('EXECUTOR_UNREACHABLE', message),
      );
    };
    socket.setEncoding('utf8');
    socket.setTimeout(15000, () =>
      fail('Control response timed out. Query the same request ID before retrying.'),
    );
    socket.on('error', () =>
      fail(
        'Workroom executor is unreachable. Start or restart the updated app; do not assume a command failed.',
      ),
    );
    socket.on('connect', () => {
      const message =
        JSON.stringify({ token: config.token, sessionId: clientSession, action, input }) + '\n';
      if (Buffer.byteLength(message) > MAX_BYTES) return fail('Control request too large.');
      socket.write(message);
    });
    socket.on('data', (chunk) => {
      if (settled) return;
      text += chunk;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BYTES) return fail('Control response too large.');
      if (!text.includes('\n')) return;
      try {
        const result = JSON.parse(text.slice(0, text.indexOf('\n')));
        if (!result.ok) return fail(result.error);
        settled = true;
        socket.end();
        resolve(result.value);
      } catch {
        fail('Invalid control response.');
      }
    });
    socket.on('end', () => {
      if (!text.includes('\n'))
        fail('Executor disconnected. Query the request ID after reconnecting.');
    });
    socket.on('close', () => {
      if (!settled) fail('Executor disconnected. Query the request ID after reconnecting.');
    });
  });
}
