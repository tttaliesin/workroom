import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workroom } from '../core/service.mjs';
import { portfolioHTML } from '../core/export.mjs';
import { dataDirectory, databaseFile, projectRoot } from '../core/paths.mjs';
import { prepareCodexSetup, installCodexSetup } from '../integrations/codex-setup.mjs';
import { CredentialVault } from '../runtime/vault.mjs';
import { RuntimeBroker } from '../runtime/broker.mjs';
import { AgentEngine } from '../runtime/engine.mjs';

const appId = 'workroom.local.desktop';
const appIcon = path.join(
  projectRoot,
  'src/desktop/assets',
  process.platform === 'win32' ? 'workroom.ico' : 'workroom.png',
);
if (process.platform === 'win32') app.setAppUserModelId(appId);
mkdirSync(path.join(dataDirectory, 'desktop'), { recursive: true });
app.setPath('userData', path.join(dataDirectory, 'desktop'));
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  process.exit(0);
}
const pageURL = pathToFileURL(path.join(projectRoot, 'src/renderer/index.html')).href;
const room = new Workroom(databaseFile);
let window;
let broker,
  engine,
  operationTimer,
  exiting = false;
app.on('second-instance', () => {
  if (window) {
    window.show();
    window.restore();
    window.focus();
  }
});
function checkSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== pageURL
  )
    throw new Error('허용되지 않은 화면 요청입니다.');
}
const allowed = new Set([
  'snapshot',
  'changes',
  'createProduct',
  'updateProduct',
  'inspect',
  'addRecord',
  'toggleRecord',
  'requestDecision',
  'resolveDecision',
  'deferDecision',
  'reportWork',
  'createPortfolio',
  'savePortfolio',
  'context',
  'setCodexCapture',
  'changeWorkLink',
  'reviewRecord',
  'reviewPortfolioSource',
]);
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      checkSender(event);
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}
handle('workroom:call', async (method, args) => {
  if (!allowed.has(method)) throw new Error('지원하지 않는 작업입니다.');
  if (method === 'snapshot')
    return {
      ...room.snapshot(),
      runtime: engine?.info() || { state: 'starting' },
      agentRuns: room.store.list('agent-run'),
      agentEvidence: room.store.list('agent-evidence'),
      agentContexts: room.store.list('agent-context'),
      agentChanges: room.store.list('change-set'),
      applyJournals: room.store.list('apply-journal'),
    };
  return room[method](args);
});
handle('workroom:runtime', async (method, args = {}) => {
  if (!engine) throw new Error('내장 실행기를 준비하고 있습니다.');
  if (method === 'configure') return engine.configure(args);
  if (method === 'configureOperations') return engine.operations.configure(args);
  if (method === 'checkOperations')
    return engine.operations.observe({ productId: args.productId, manual: true });
  if (method === 'issueAction') return engine.operations.act(args);
  if (method === 'editPortfolio') return engine.editor.request({ portfolioId: args.portfolioId });
  if (method === 'configurePortfolioEditor') return engine.editor.configure(args);
  if (method === 'applyPortfolioEdit') return engine.editor.apply(args);
  if (method === 'start') return engine.start(args);
  if (method === 'resume') return engine.resume(args);
  if (method === 'stop') return engine.stop(args);
  if (method === 'applyChange') return engine.changes.apply(args);
  if (method === 'restart') {
    if (broker.child) throw new Error('실행기가 연결되어 있습니다.');
    await broker.start();
    return engine.info();
  }
  if (method === 'logout' && !broker.child) {
    broker.vault.write(null);
    await broker.start();
    return engine.info();
  }
  if (!['login', 'cancelLogin', 'manualCode', 'logout', 'verify'].includes(method))
    throw new Error('지원하지 않는 실행 요청입니다.');
  if (['login', 'logout', 'verify'].includes(method) && engine.active.size)
    throw new Error('진행 중인 작업을 먼저 중지하세요.');
  if (method === 'login' && !['browser', 'device_code'].includes(args.mode))
    throw new Error('로그인 방법을 선택하세요.');
  if (method === 'verify') args = { modelId: engine.settings.modelId };
  return broker.request(method, args);
});
handle('workroom:folder', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: '관리할 제품 폴더',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});
handle('workroom:export', async (id, revision) => {
  const snapshot = room.prepareExport(id, revision);
  const result = await dialog.showSaveDialog(window, {
    title: '포트폴리오 HTML 내보내기',
    defaultPath: 'portfolio.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, portfolioHTML(snapshot), 'utf8');
  // The exported snapshot is immutable even if MCP changes the draft while the dialog is open.
  room.recordExport(id, snapshot, result.filePath);
  return { filename: result.filePath };
});
handle('workroom:connection', () => ({
  dataDirectory,
  nodeRequired: 'Node.js 24 이상',
  config: {
    mcpServers: {
      workroom: {
        command: process.env.WORKROOM_NODE || 'node',
        args: [path.join(projectRoot, 'src/mcp/server.mjs')],
        env: { WORKROOM_DATA_DIR: dataDirectory },
      },
    },
  },
}));
const hookRuntime = {
  database: databaseFile,
  node: process.env.WORKROOM_NODE || 'node',
  script: path.join(projectRoot, 'src/integrations/codex-hook.mjs'),
};
handle('workroom:codex-setup', async (productId, revision) => {
  try {
    const { stdout } = await promisify(execFile)(hookRuntime.node, ['--version'], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024,
    });
    if (Number(stdout.trim().match(/^v(\d+)/)?.[1]) < 24 || !/^v\d+/.test(stdout.trim()))
      throw new Error('version');
  } catch {
    throw new Error(
      '자동 수집에는 Node.js 24 이상이 필요합니다. WORKROOM_NODE에 Node 실행 파일 경로를 지정한 뒤 앱을 다시 열어주세요.',
    );
  }
  return revision === undefined
    ? prepareCodexSetup(room, productId, hookRuntime)
    : installCodexSetup(room, productId, revision, hookRuntime);
});

app
  .whenReady()
  .then(async () => {
    const agentDirectory = path.join(dataDirectory, 'pi');
    mkdirSync(agentDirectory, { recursive: true });
    broker = new RuntimeBroker({
      vault: new CredentialVault(path.join(dataDirectory, 'credentials'), safeStorage),
      fork: () =>
        utilityProcess.fork(path.join(projectRoot, 'src/runtime/pi-worker.mjs'), [], {
          serviceName: '작업실 Pi',
          cwd: agentDirectory,
          stdio: 'pipe',
          env: Object.fromEntries(
            [
              'SystemRoot',
              'WINDIR',
              'PATH',
              'TEMP',
              'TMP',
              'LOCALAPPDATA',
              'APPDATA',
              'USERPROFILE',
            ]
              .filter((key) => process.env[key])
              .map((key) => [key, process.env[key]]),
          ),
        }),
      openBrowser: (url) => shell.openExternal(url),
      onChange: () => {
        if (!exiting) {
          room.store.log('계정 연결 상태 변경', 'runtime');
          engine?.pump();
        }
      },
    });
    engine = new AgentEngine(room, broker, {
      agentDirectory,
      nodeExecutable: process.env.WORKROOM_NODE || 'node',
    });
    broker.onTool = (input) => engine.tool(input);
    broker.onProgress = (event) => engine.progress(event);
    await broker.start();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({
      width: 1240,
      height: 860,
      minWidth: 760,
      minHeight: 600,
      show: process.env.WORKROOM_HEADLESS !== '1',
      title: '작업실 · 로컬 알파',
      icon: appIcon,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(projectRoot, 'src/desktop/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        offscreen: process.env.WORKROOM_HEADLESS === '1',
      },
    });
    if (process.platform === 'win32')
      window.setAppDetails({ appId, appIconPath: appIcon, appIconIndex: 0 });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question',
        title: '저장하지 않은 변경',
        message: '저장하지 않은 입력을 버리고 닫을까요?',
        buttons: ['계속 작성', '입력 버리고 닫기'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice === 1) event.preventDefault();
    });
    await window.loadURL(pageURL);
    const operationTick = () =>
      void engine.operations.tick().catch((error) => {
        if (!exiting) room.store.log('운영 점검 오류', 'runtime', error.message);
      });
    operationTimer = setInterval(operationTick, 30000);
    operationTimer.unref();
    operationTick();
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  exiting = true;
  clearInterval(operationTimer);
  if (engine) void engine.shutdown();
  broker?.close();
});
app.on('will-quit', () => room.close());
