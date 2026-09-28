import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { controlRequest } from './transport.mjs';
const require = createRequire(import.meta.url);
export async function connectControl(directory, root, { start = false } = {}) {
  try {
    return await controlRequest(directory, 'status');
  } catch (error) {
    if (!start)
      return {
        liveConnection: false,
        error: error.message,
        recovery: 'Call workroom_control_connect with start:true.',
      };
  }
  const env = { ...process.env, WORKROOM_DATA_DIR: directory, WORKROOM_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORKROOM_HEADLESS;
  const child = spawn(require('electron'), [root, '--workroom-service'], {
    cwd: root,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  child.unref();
  for (let n = 0; n < 40; n++) {
    if (launchError)
      throw new Error('Unable to start Workroom executor. Check the Electron installation.');
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await controlRequest(directory, 'status');
    } catch {}
  }
  throw new Error(
    'Executor did not become ready. If an older Workroom is already running, close it normally and reconnect with start:true.',
  );
}
