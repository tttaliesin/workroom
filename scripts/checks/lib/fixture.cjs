const fs = require('node:fs');
const path = require('node:path');

const work = path.resolve(__dirname, '../../../work');

// Only remove a directory created by this process, never a profile discovered on disk.
function createFixture(prefix, { cleanupRetries = 5 } = {}) {
  prefix = path.resolve(prefix);
  if (path.dirname(prefix) !== work || !/^[a-z][a-z0-9-]*-$/.test(path.basename(prefix)))
    throw new Error('Fixture prefix must be directly inside the project work directory.');
  fs.mkdirSync(work, { recursive: true });
  if (fs.realpathSync(work) !== work) throw new Error('Fixture parent must not be a link.');
  const directory = fs.mkdtempSync(prefix);
  const identity = fs.statSync(directory);
  // Keep the event loop alive while Windows releases handles from terminated Electron children.
  process.once('beforeExit', async (code) => {
    if (code !== 0 || process.env.WORKROOM_KEEP_FIXTURES === '1') return;
    try {
      for (let attempt = 0; attempt <= cleanupRetries; attempt++) {
        if (!fs.existsSync(directory)) return;
        const current = fs.lstatSync(directory);
        if (
          path.dirname(directory) !== work ||
          fs.realpathSync(work) !== work ||
          current.isSymbolicLink() ||
          current.dev !== identity.dev ||
          current.ino !== identity.ino
        )
          throw new Error('Fixture path changed; refusing cleanup.');
        try {
          await fs.promises.rm(directory, { recursive: true });
          break;
        } catch (error) {
          if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || attempt === cleanupRetries) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    } catch (error) {
      console.error(`Fixture cleanup failed: ${directory}: ${error.message}`);
      process.exitCode = 1;
    }
  });
  return directory;
}

module.exports = { createFixture };
