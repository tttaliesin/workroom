import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  safeStorage,
  shell,
  utilityProcess,
  Tray,
  Menu,
  clipboard,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCommands } from '../control/commands.mjs';
import { ControlService } from '../control/service.mjs';
import { failure } from '../control/contracts.mjs';
import { listenControl } from '../control/transport.mjs';
import { Workroom } from '../core/service.mjs';
import { Publications } from '../core/publication.mjs';
import { VercelPublisher } from '../integrations/vercel.mjs';
import { dataDirectory, databaseFile, projectRoot } from '../core/paths.mjs';
import { prepareCodexSetup, installCodexSetup } from '../integrations/codex-setup.mjs';
import { CredentialVault } from '../runtime/vault.mjs';
import { RuntimeBroker } from '../runtime/broker.mjs';
import { AgentEngine } from '../runtime/engine.mjs';
import { runtimeEmbeddings } from '../runtime/local-embeddings.mjs';
import { CodexConnection } from '../integrations/codex-connection.mjs';
import { mcpServerConfig } from '../integrations/mcp-config.mjs';
import { codexTerminal } from './codex-terminal.mjs';
import { t, getLanguage, setLanguage } from '../shared/i18n.mjs';

const appId = 'workroom.local.desktop';
const appIcon = path.join(
  projectRoot,
  'src/desktop/assets',
  process.platform === 'win32' ? 'workroom.ico' : 'workroom.png',
);
if (process.platform === 'win32') app.setAppUserModelId(appId);
mkdirSync(path.join(dataDirectory, 'desktop'), { recursive: true });
const languageFile = path.join(dataDirectory, 'desktop', 'language.json');
try {
  setLanguage(JSON.parse(readFileSync(languageFile, 'utf8')));
} catch {
  /* Default: Korean. */
}
app.setPath('userData', path.join(dataDirectory, 'desktop'));
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  process.exit(0);
}
const pageURL = pathToFileURL(path.join(projectRoot, 'src/renderer/index.html')).href;
const room = new Workroom(databaseFile, { embedding: runtimeEmbeddings(dataDirectory) });
const publishVault = new CredentialVault(
  path.join(dataDirectory, 'publication'),
  safeStorage,
  'vercel.credential',
);
const publications = new Publications(room, new VercelPublisher(publishVault));
const codex = new CodexConnection({ directory: dataDirectory, root: projectRoot });
let terminalWindow, terminalProductId;
let window;
let tray;
let broker,
  engine,
  operationTimer,
  exiting = false;
const commands = createCommands({
  room,
  getEngine: () => engine,
  getBroker: () => broker,
  publications,
  publishVault,
  shell,
});
const control = new ControlService({
  room,
  commands,
  getEngine: () => engine,
  languageFile,
  dataDirectory,
});
let controlServer;
app.on('second-instance', (_event, argv) => {
  if (argv.includes('--workroom-service')) return;
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
    throw new Error(t('허용되지 않은 화면 요청입니다.'));
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      checkSender(event);
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      const problem = failure(error);
      return {
        ok: false,
        ...problem,
        error: t(problem.message),
      };
    }
  });
}
handle('workroom:language', async (language) => {
  if (language !== undefined) {
    await control.fromApp('settings.language', { language });
  }
  return getLanguage();
});
handle('workroom:call', (method, args = {}, requestId) =>
  ['snapshot', 'changes'].includes(method)
    ? commands.core(method, args)
    : control.fromApp(`core.${method}`, args, requestId),
);

handle('workroom:runtime', (method, args = {}, requestId) =>
  control.fromApp(`runtime.${method}`, args, requestId),
);

handle('workroom:folder', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: t('관리할 제품 폴더'),
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});
handle('workroom:publication', (method, args = {}, requestId) =>
  method === 'open'
    ? commands.publication(method, args)
    : control.fromApp(`publication.${method}`, args, requestId),
);

handle('workroom:project-report', async (requestId, action) => {
  const operation = control.operation(requestId);
  if (operation.command !== 'core.projectReport' || operation.status !== 'completed')
    throw new Error(t('먼저 보고서를 생성하세요.'));
  if (action === 'copy') {
    clipboard.writeText(operation.result.markdown);
    return { copied: true };
  }
  if (action !== 'save') throw new Error('Unknown report output action');
  const selected = await dialog.showSaveDialog(window, {
    title: t('프로젝트 현황 보고'),
    defaultPath: 'project-status.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (selected.canceled || !selected.filePath) return null;
  await writeFile(selected.filePath, operation.result.html, 'utf8');
  return { filename: selected.filePath };
});
handle('workroom:export', async (id, revision) => {
  const artifact = await control.fromApp('artifact.export', {
    id,
    revision,
    language: getLanguage(),
  });
  const result = await dialog.showSaveDialog(window, {
    title: t('포트폴리오 HTML 내보내기'),
    defaultPath: 'portfolio.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, artifact.html, 'utf8');
  // The exported snapshot is immutable even if MCP changes the draft while the dialog is open.
  await control.fromApp('artifact.recordExport', {
    artifactId: artifact.artifactId,
    filename: result.filePath,
  });
  return { filename: result.filePath };
});
handle('workroom:connection', async (action) => {
  const info = {
    dataDirectory,
    nodeRequired: t('Node.js 24 이상'),
    config: {
      mcpServers: {
        workroom: mcpServerConfig({
          node: (await codex.detect()).node?.path || process.env.WORKROOM_NODE || 'node',
          root: projectRoot,
          directory: dataDirectory,
        }),
      },
    },
  };
  if (action === 'copy') clipboard.writeText(JSON.stringify(info.config, null, 2));
  return info;
});
const hookRuntime = {
  database: databaseFile,
  node: process.env.WORKROOM_NODE || 'node',
  script: path.join(projectRoot, 'src/integrations/codex-hook.mjs'),
};
async function codexSetup(productId, revision) {
  const detected = await codex.detect();
  hookRuntime.node = detected.node?.path || hookRuntime.node;
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
      t(
        '자동 수집에는 Node.js 24 이상이 필요합니다. Codex 연결 화면에서 Node.js 실행 파일을 선택하세요.',
      ),
    );
  }
  return revision === undefined
    ? prepareCodexSetup(room, productId, hookRuntime)
    : installCodexSetup(room, productId, revision, hookRuntime);
}
handle('workroom:codex-setup', (productId, revision) =>
  control.fromApp(revision === undefined ? 'connection.prepareHooks' : 'connection.installHooks', {
    productId,
    ...(revision === undefined ? {} : { revision }),
  }),
);
async function codexConnection(action, productId, value) {
  const product = productId ? room.store.get('product', productId) : null;
  if (action === 'status') return codex.status(product);
  if (action === 'prepare') return codex.prepare(product?.folder || projectRoot);
  if (action === 'install') return codex.install(value);
  if (action === 'probe') return codex.probe(product);
  if (action === 'select') {
    if (!['node', 'codex'].includes(value)) throw new Error(t('실행 파일 종류를 확인하세요.'));
    const result = await dialog.showOpenDialog(window, {
      title: value === 'node' ? t('Node.js 24 이상 실행 파일 선택') : t('Codex 실행 파일 선택'),
      properties: ['openFile'],
      ...(process.platform === 'win32'
        ? { filters: [{ name: t('실행 파일'), extensions: ['exe'] }] }
        : {}),
    });
    if (!result.canceled)
      await control.fromApp('connection.select', { kind: value, path: result.filePaths[0] });
    return codex.status(product);
  }
  if (action === 'terminal') {
    if (!product) throw new Error(t('제품을 먼저 등록하세요.'));
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      if (terminalProductId !== product.id)
        throw new Error(
          t(
            '다른 제품의 Codex 창이 열려 있습니다. 해당 창을 닫은 뒤 이 제품의 승인 화면을 여세요.',
          ),
        );
      terminalWindow.focus();
      return;
    }
    terminalProductId = product.id;
    terminalWindow = codexTerminal({
      connection: codex,
      root: projectRoot,
      parent: window,
      product,
    });
    terminalWindow.on('closed', () => {
      terminalWindow = null;
    });
    return;
  }
  throw new Error(t('지원하지 않는 Codex 연결 요청입니다.'));
}
handle('workroom:codex-connection', (action, productId, value) =>
  ['terminal', 'select'].includes(action)
    ? codexConnection(action, productId, value)
    : control.fromApp(`connection.${action}`, {
        ...(productId ? { productId } : {}),
        ...(action === 'install' ? { planId: value } : {}),
      }),
);
commands.connection = async (method, args) => {
  if (method === 'select') return codex.select(args.kind, args.path);
  if (method === 'prepareHooks') return codexSetup(args.productId);
  if (method === 'installHooks') {
    if (!args.revision) throw new Error('Review hook settings and provide their revision.');
    return codexSetup(args.productId, args.revision);
  }
  if (!['status', 'prepare', 'install', 'probe'].includes(method))
    throw new Error('Unknown connection command.');
  return codexConnection(method, args.productId, args.planId);
};

app
  .whenReady()
  .then(async () => {
    const agentDirectory = path.join(dataDirectory, 'pi');
    mkdirSync(agentDirectory, { recursive: true });
    broker = new RuntimeBroker({
      vault: new CredentialVault(path.join(dataDirectory, 'credentials'), safeStorage),
      fork: () =>
        utilityProcess.fork(path.join(projectRoot, 'src/runtime/pi-worker.mjs'), [], {
          serviceName: t('작업실 Pi'),
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
          room.store.log(t('계정 연결 상태 변경'), 'runtime');
          engine?.pump();
        }
      },
    });
    engine = new AgentEngine(room, broker, {
      agentDirectory,
      nodeExecutable: process.env.WORKROOM_NODE || 'node',
    });
    engine.scheduleOperations = () =>
      control.run(
        'runtime.tick',
        {},
        { caller: { channel: 'scheduler', sessionId: control.instanceId } },
      );
    broker.onTool = (input) => engine.tool(input);
    broker.onProgress = (event) => engine.progress(event);
    controlServer = await listenControl(dataDirectory, (message, caller) =>
      control.handle(message, caller),
    );
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
      show: process.env.WORKROOM_HEADLESS !== '1' && !process.argv.includes('--workroom-service'),
      title: t('작업실 · 로컬 알파'),
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
    tray = new Tray(appIcon);
    tray.setToolTip('Workroom');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('작업실 열기'), click: () => window.show() },
        { label: t('완전히 종료'), click: () => app.quit() },
      ]),
    );
    tray.on('double-click', () => window.show());
    window.on('close', (event) => {
      if (!exiting && engine.settings.background) {
        event.preventDefault();
        window.hide();
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question',
        title: t('저장하지 않은 변경'),
        message: t('저장하지 않은 입력을 버리고 닫을까요?'),
        buttons: [t('계속 작성'), t('입력 버리고 닫기')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice === 1) event.preventDefault();
    });
    await window.loadURL(pageURL);
    room.knowledge.index?.start();
    const operationTick = () =>
      void engine.scheduleOperations().catch((error) => {
        if (!exiting) room.store.log(t('운영 점검 오류'), 'runtime', error.message);
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
  controlServer?.close();
  clearInterval(operationTimer);
  if (engine) void engine.shutdown();
  broker?.close();
  tray?.destroy();
});
app.on('will-quit', () => room.close());
