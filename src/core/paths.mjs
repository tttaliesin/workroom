import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dataDirectory = path.resolve(process.env.WORKROOM_DATA_DIR || path.join(projectRoot, '.workroom'));
export const databaseFile = path.join(dataDirectory, 'workroom.sqlite');
