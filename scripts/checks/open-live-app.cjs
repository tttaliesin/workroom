// Opens the app on the live-check data folder so you can sign in for live-model checks there.
// Usage: node scripts/checks/open-live-app.cjs   (close the window when you are done)
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { liveDataDirectory } = require('./lib/live-data.cjs');

const root = path.resolve(__dirname, '../..');
fs.mkdirSync(liveDataDirectory, { recursive: true });
const env = { ...process.env, WORKROOM_DATA_DIR: liveDataDirectory, WORKROOM_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WORKROOM_HEADLESS;
console.log(`Opening Workroom with live-check data in ${path.relative(root, liveDataDirectory)}`);
spawn(require('electron'), [root], { env, stdio: 'inherit' }).on('exit', (code) =>
  process.exit(code ?? 0),
);
