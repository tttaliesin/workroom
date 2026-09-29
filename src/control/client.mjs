import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { controlRequest } from './transport.mjs';
import { contractVersion, failure } from './contracts.mjs';
import { schemaHash } from './catalog.mjs';
import { loadedBuild, sourceBuild } from '../core/build-info.mjs';
const require = createRequire(import.meta.url);
const normalized = (directory) => {
  const absolute = path.resolve(directory);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};
const sameDirectory = (a, b) => !!a && !!b && normalized(a) === normalized(b);
const freshness = (build, disk) =>
  !build?.sourceHash || !disk?.sourceHash
    ? 'unknown'
    : build.sourceHash === disk.sourceHash
      ? 'current'
      : 'outdated';

export function connectionStatus(
  status,
  { directory, expectedDataDirectory, adapterBuild = loadedBuild, diskBuild },
) {
  const compatible = status.protocol === 2;
  const contractCompatible =
    status.contractVersion === contractVersion && status.schemaHash === schemaHash;
  const profileCompatible =
    (!expectedDataDirectory || sameDirectory(expectedDataDirectory, directory)) &&
    (!status.dataDirectory || sameDirectory(status.dataDirectory, directory));
  const adapter = {
    ...adapterBuild,
    protocol: 2,
    contractVersion,
    schemaHash,
    dataDirectory: directory,
    freshness: freshness(adapterBuild, diskBuild),
  };
  const executor = {
    ...status.build,
    protocol: status.protocol,
    contractVersion: status.contractVersion,
    schemaHash: status.schemaHash,
    dataDirectory: status.dataDirectory || null,
    freshness: freshness(status.build, diskBuild),
  };
  const diagnostics = [];
  if (!profileCompatible)
    diagnostics.push({
      code: 'PROFILE_MISMATCH',
      action: 'check_profile',
      message: 'Check the intended data directory and client MCP configuration before any changes.',
    });
  if (adapter.freshness === 'outdated')
    diagnostics.push({
      code: 'ADAPTER_OUTDATED',
      action: 'refresh_client_mcp',
      message:
        'Refresh this client’s Workroom MCP connection to load the installed source. Do not restart the executor for this step.',
    });
  if (executor.freshness === 'outdated')
    diagnostics.push({
      code: 'EXECUTOR_OUTDATED',
      action: 'review_executor_restart',
      message:
        'Check active work, pending operations and unsaved app input before restarting the executor. Do not terminate it automatically.',
    });
  if (!compatible || !contractCompatible)
    diagnostics.push({
      code: compatible ? 'CONTRACT_MISMATCH' : 'PROTOCOL_MISMATCH',
      action: 'compare_components',
      message:
        'Adapter and executor contracts differ. Follow known component freshness; unknown means the older component cannot be identified. Refresh client MCP first, then recheck before considering a safe executor restart.',
    });
  return {
    ...status,
    compatible,
    contractCompatible,
    profileCompatible,
    expectedContract: { contractVersion, schemaHash },
    ...(expectedDataDirectory ? { expectedDataDirectory } : {}),
    adapter,
    executor,
    installed: diskBuild,
    diagnostics,
    readyForControl:
      status.liveConnection === true &&
      compatible &&
      contractCompatible &&
      profileCompatible &&
      adapter.freshness !== 'outdated' &&
      executor.freshness !== 'outdated',
    ...(diagnostics.length ? { recovery: diagnostics.map((item) => item.message).join(' ') } : {}),
  };
}

export async function connectControl(
  directory,
  root,
  { start = false, expectedDataDirectory } = {},
) {
  const diskBuild = sourceBuild(root);
  const options = { directory, expectedDataDirectory, diskBuild };
  // Never start the wrong profile, even if the caller also supplied start:true.
  if (expectedDataDirectory && !sameDirectory(expectedDataDirectory, directory)) {
    return connectionStatus({ liveConnection: false, dataDirectory: directory }, options);
  }
  try {
    return connectionStatus(await controlRequest(directory, 'status'), options);
  } catch (error) {
    if (!start || error.code !== 'EXECUTOR_OFFLINE') {
      const offline = error.code === 'EXECUTOR_OFFLINE';
      return {
        liveConnection: false,
        readyForControl: false,
        dataDirectory: directory,
        adapter: {
          ...loadedBuild,
          protocol: 2,
          contractVersion,
          schemaHash,
          dataDirectory: directory,
          freshness: freshness(loadedBuild, diskBuild),
        },
        installed: diskBuild,
        error: error.message,
        failure: failure(error, { phase: 'transport' }),
        diagnostic: offline ? 'EXECUTOR_OFFLINE' : 'CONNECTION_FAILED',
        recovery: offline
          ? 'Check the intended profile, then call workroom_control_connect with start:true.'
          : 'Inspect failure.code and failure.details. Correct access or configuration and reconnect; do not blindly start or restart an executor.',
      };
    }
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
      return connectionStatus(await controlRequest(directory, 'status'), options);
    } catch {}
  }
  throw new Error(
    'Executor did not become ready. Inspect profile, endpoint and active work; do not terminate an existing app without checking unsaved state.',
  );
}
