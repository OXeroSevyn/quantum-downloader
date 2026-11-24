import fs from 'fs';
import path from 'path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Turns any untrusted name (from a URL, Content-Disposition header, the browser
 * extension or a torrent) into a safe single path component. Directory parts,
 * traversal sequences, control and reserved characters are all removed, so the
 * result can never escape the folder it is joined to.
 */
export function sanitizeFilename(raw: string | undefined | null, fallback = 'download'): string {
  let name = String(raw ?? '');
  try {
    if (/%[0-9a-f]{2}/i.test(name)) name = decodeURIComponent(name);
  } catch {
    /* keep as-is */
  }
  // Keep only the last path component (handles both / and \ separators)
  name = name.split(/[\\/]+/).pop() || '';
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '') // no leading dots (hidden files, "..")
    .replace(/[.\s]+$/, '') // Windows strips trailing dots/spaces
    .trim();

  if (!name || WINDOWS_RESERVED.test(name)) name = fallback;
  if (name.length > 200) {
    const ext = path.extname(name).slice(0, 16);
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name;
}

/** True when `target` resolves to a location inside `dir`. */
export function isInsideDir(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Returns a path in `dir` for `filename` that is not on disk and not claimed by
 * any path in `taken` (case-insensitive, as on Windows), adding " (1)", " (2)"…
 */
export function uniqueFilePath(dir: string, filename: string, taken: Iterable<string> = []): string {
  const claimed = new Set(Array.from(taken, (p) => path.resolve(p).toLowerCase()));
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  for (let i = 0; i < 10000; i++) {
    const candidate = path.join(dir, i === 0 ? filename : `${base} (${i})${ext}`);
    if (!claimed.has(path.resolve(candidate).toLowerCase()) && !fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

export function safeUnlink(p: string | undefined): void {
  if (!p) return;
  try {
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
