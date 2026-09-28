// Live-model checks need a signed-in account, so they use their own data folder that is signed
// in once with open-live-app.cjs. They must never write to the data the app itself uses.
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const liveDataDirectory = path.join(root, 'work', 'live-data');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function assertLiveData(directory) {
  if (!directory || !same(directory, liveDataDirectory))
    throw new Error(
      `Live checks only use ${path.relative(root, liveDataDirectory)}, not ${directory}. ` +
        'Delete the old work/*-session.json files and prepare the check again.',
    );
  return liveDataDirectory;
}

module.exports = { liveDataDirectory, assertLiveData };
