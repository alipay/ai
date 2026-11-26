import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node resolves ES modules to their real paths even when the launcher used a link.
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
