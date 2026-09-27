import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLanguage, t } from '../shared/i18n.mjs';

export function codexTerminal({ connection, root, parent, product }) {
  const page = pathToFileURL(path.join(root, 'src/renderer/codex-terminal.html')).href;
  const terminal = new BrowserWindow({
    parent,
    width: 1060,
    height: 760,
    minWidth: 700,
    minHeight: 500,
    title: `${t('Codex 연결')} · ${product.name}`,
    show: process.env.WORKROOM_HEADLESS !== '1',
    webPreferences: {
      preload: path.join(root, 'src/desktop/codex-terminal-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.WORKROOM_HEADLESS === '1',
      backgroundThrottling: false,
    },
  });
  const channel = 'workroom:terminal';
  let rpc,
    started = false,
    disposed = false;
  const emit = (value) => {
    if (!terminal.isDestroyed()) terminal.webContents.send('workroom:terminal-data', value);
  };
  ipcMain.handle(channel, async (event, action, value) => {
    try {
      if (
        event.sender !== terminal.webContents ||
        event.senderFrame !== terminal.webContents.mainFrame ||
        event.senderFrame.url !== page
      )
        throw new Error('허용되지 않은 화면 요청입니다.');
      if (action === 'language') return { ok: true, language: getLanguage() };
      if (action === 'start') {
        if (started) throw new Error('이미 Codex를 실행했습니다.');
        started = true;
        rpc = await connection.connect(product.folder, (message) => {
          if (message.params?.processHandle !== 'codex') return;
          if (message.method === 'process/outputDelta') emit({ data: message.params.deltaBase64 });
          if (message.method === 'process/exited') emit({ exit: message.params.exitCode });
        });
        if (disposed) {
          rpc.close();
          return { ok: true };
        }
        await rpc.request('process/spawn', {
          command: [connection.paths.codex, '--no-daemon', '--no-alt-screen'],
          cwd: product.folder,
          processHandle: 'codex',
          tty: true,
          size: { cols: 100, rows: 30 },
          timeoutMs: null,
          outputBytesCap: null,
          env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        });
        return { ok: true, folder: product.folder };
      }
      if (!rpc) throw new Error('Codex가 아직 시작되지 않았습니다.');
      if (action === 'input') {
        if (typeof value !== 'string' || value.length > 65536)
          throw new Error('입력 크기를 확인하세요.');
        await rpc.request('process/writeStdin', {
          processHandle: 'codex',
          deltaBase64: Buffer.from(value).toString('base64'),
        });
      } else if (action === 'resize') {
        if (![value?.cols, value?.rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 500))
          throw new Error('화면 크기를 확인하세요.');
        await rpc.request('process/resizePty', { processHandle: 'codex', size: value });
      } else throw new Error('지원하지 않는 터미널 요청입니다.');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: t(error.message) };
    }
  });
  terminal.setMenuBarVisibility(false);
  terminal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  terminal.webContents.on('will-navigate', (event) => event.preventDefault());
  terminal.on('closed', () => {
    disposed = true;
    ipcMain.removeHandler(channel);
    if (rpc)
      void rpc
        .request('process/kill', { processHandle: 'codex' }, 2000)
        .catch(() => {})
        .finally(() => rpc.close());
  });
  void terminal.loadURL(page);
  return terminal;
}
