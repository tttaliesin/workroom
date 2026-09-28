import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { controlRequest } from './transport.mjs';
const require = createRequire(import.meta.url);
const connection = (status) => ({
  ...status,
  compatible: status.protocol === 2,
  ...(status.protocol === 2
    ? {}
    : {
        recovery:
          'Close the older Workroom normally, then connect with start:true. Protocol 2 is required.',
      }),
});
export async function connectControl(directory, root, { start = false } = {}) {
  try {
    return connection(await controlRequest(directory, 'status'));
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
      return connection(await controlRequest(directory, 'status'));
    } catch {}
  }
  throw new Error(
    'Executor did not become ready. If an older Workroom is already running, close it normally and reconnect with start:true.',
  );
}
