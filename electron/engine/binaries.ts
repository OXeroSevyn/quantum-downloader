import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { execFileSync } from 'child_process';

/** Locates a bundled helper (yt-dlp, ffmpeg) in dev (./bin) or packaged (resources/bin) builds. */
export function getBinaryPath(name: string): string {
  const bare = name.replace(/\.exe$/i, '');
  const file = process.platform === 'win32' ? `${bare}.exe` : bare;
  const dirs = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin') : '',
    app?.getAppPath ? path.join(app.getAppPath(), '..', 'bin') : '',
    path.join(process.cwd(), 'bin'),
    path.join(__dirname, '..', '..', 'bin'),
  ].filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dirs[dirs.length - 1], file);
}

let cachedRuntime: { arg: string; env: NodeJS.ProcessEnv } | null | undefined;

/**
 * yt-dlp needs a JavaScript runtime for YouTube. Use a system Node.js when one
 * exists; otherwise run Electron itself as Node (ELECTRON_RUN_AS_NODE), so the
 * app works on machines without Node installed.
 */
export function getJsRuntime(): { arg: string; env: NodeJS.ProcessEnv } | null {
  if (cachedRuntime !== undefined) return cachedRuntime;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const found = execFileSync(cmd, ['node'], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (found && fs.existsSync(found)) {
      cachedRuntime = { arg: `node:${found}`, env: {} };
      return cachedRuntime;
    }
  } catch {
    /* no system node */
  }
  if (process.execPath && fs.existsSync(process.execPath)) {
    cachedRuntime = { arg: `node:${process.execPath}`, env: { ELECTRON_RUN_AS_NODE: '1' } };
    return cachedRuntime;
  }
  cachedRuntime = null;
  return null;
}
