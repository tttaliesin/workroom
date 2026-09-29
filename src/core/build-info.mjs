import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './paths.mjs';

// Source identity is diagnostic only, never a substitute for command contracts.
// No Git subprocess, user profile, credential file or dependency tree is read.
export function sourceBuild(root = projectRoot) {
  try {
    const hash = createHash('sha256');
    const visit = (relative) => {
      for (const item of readdirSync(path.join(root, relative), { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name, 'en'),
      )) {
        if (item.isSymbolicLink()) continue;
        const name = path.join(relative, item.name);
        if (item.isDirectory()) visit(name);
        else if (/\.(m?js|cjs|json)$/.test(name)) {
          hash.update(name.replaceAll('\\', '/') + '\0');
          hash.update(readFileSync(path.join(root, name)));
        }
      }
    };
    const manifest = readFileSync(path.join(root, 'package.json'));
    hash.update(manifest);
    visit('src');
    return { version: JSON.parse(manifest).version, sourceHash: hash.digest('hex') };
  } catch {
    return { version: 'unknown', sourceHash: null };
  }
}
export const loadedBuild = sourceBuild();
