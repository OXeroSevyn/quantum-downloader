// Engine tests: run with `npm test`. Spins up a local HTTP server and checks segmented,
// resumable, throttled and HLS downloads byte-for-byte, plus filename safety.
const http = require('http'), fs = require('fs'), crypto = require('crypto'), path = require('path');
const B = require('path').join(__dirname, '..', 'dist-electron');
const OUT = require('path').join(require('os').tmpdir(), 'quantum-engine-tests');
const { SegmentedDownloader } = require(B + '/engine/segmented-downloader');
const { HlsDownloader } = require(B + '/engine/hls-downloader');
const { RateLimiter } = require(B + '/engine/rate-limiter');
const { sanitizeFilename, uniqueFilePath, isInsideDir } = require(B + '/engine/file-utils');

const data = crypto.randomBytes(12 * 1024 * 1024);
const h = (b) => crypto.createHash('sha256').update(b).digest('hex');
let mode = 'normal', dropOnce = new Set(), hlsFail = {}, slow = 0;
const key = crypto.randomBytes(16), iv = crypto.randomBytes(16);
const segs = [0, 1, 2, 3, 4, 5].map((i) => crypto.randomBytes(50000 + i));
const enc = segs.map((s) => { const c = crypto.createCipheriv('aes-128-cbc', key, iv); return Buffer.concat([c.update(s), c.final()]); });

const srv = http.createServer((req, res) => {
  const u = req.url;
  if (u.startsWith('/file')) {
    const noRange = mode === 'liar' || mode === 'norange';
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': data.length, ...(mode === 'norange' ? {} : { 'Accept-Ranges': 'bytes' }) });
      return res.end();
    }
    const r = req.headers.range;
    if (r && !noRange) {
      const m = r.match(/bytes=(\d+)-(\d*)/);
      const s = +m[1], e = m[2] ? +m[2] : data.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${data.length}`, 'Content-Length': e - s + 1 });
      let p = s;
      const fast = s === 0;
      const t = setInterval(() => {
        if (p > e) { clearInterval(t); return res.end(); }
        if (mode === 'drop' && !dropOnce.has(s) && p - s > 100000) { dropOnce.add(s); clearInterval(t); return req.socket.destroy(); }
        const n = Math.min(fast && mode === 'steal' ? 1024 * 1024 : 64 * 1024, e - p + 1);
        res.write(data.subarray(p, p + n)); p += n;
      }, slow || 5);
      req.on('close', () => clearInterval(t));
      return;
    }
    res.writeHead(200, { 'Content-Length': data.length });
    let p = 0;
    const t = setInterval(() => {
      if (p >= data.length) { clearInterval(t); return res.end(); }
      res.write(data.subarray(p, p + 128 * 1024)); p += 128 * 1024;
    }, slow || 5);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (u === '/p.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n' + segs.map((_, i) => '#EXTINF:2,\nseg' + i + '.ts').join('\n') + '\n#EXT-X-ENDLIST'); }
  if (u === '/enc.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin",IV=0x' + iv.toString('hex') + '\n' + enc.map((_, i) => '#EXTINF:2,\ne' + i + '.ts').join('\n')); }
  if (u === '/master.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\np.m3u8\n'); }
  if (u === '/k.bin') { res.writeHead(200); return res.end(key); }
  const m = u.match(/^\/(seg|e)(\d)\.ts$/);
  if (m) {
    const i = +m[2];
    if (hlsFail[i] > 0) { hlsFail[i]--; return req.socket.destroy(); }
    if (hlsFail[i] === -1) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200);
    return setTimeout(() => res.end(m[1] === 'e' ? enc[i] : segs[i]), slow ? slow * 10 : 1);
  }
  res.writeHead(404); res.end();
});

const mk = (url, file, conn = 8) => ({ id: 't', url, filename: path.basename(file), filepath: file, totalBytes: 0, downloadedBytes: 0, speed: 0, status: 'queued', connections: conn, segments: [], category: 'other', createdAt: 0, resumable: true, autoName: false });

function run(D, task, ms, opts = {}) {
  return new Promise((r) => {
    let done = false;
    let maxPct = 0;
    const d = new D(task, {
      onProgress(x) { if (x.totalBytes) maxPct = Math.max(maxPct, x.downloadedBytes / x.totalBytes); },
      onComplete() { done = true; r({ res: 'completed', maxPct }); },
      onError(t, e) { done = true; r({ res: 'error: ' + e.message, maxPct }); },
    }, opts.rl);
    d.start();
    if (opts.pauseAt) setTimeout(() => { if (!done) { d.pause(); done = true; r({ res: 'paused' }); } }, opts.pauseAt);
    setTimeout(() => { if (!done) { d.pause(); done = true; r({ res: 'HUNG' }); } }, ms);
  });
}

let pass = 0, fail = 0;
const ok = (name, c, extra = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : '')); };

srv.listen(0, async () => {
  const U = `http://127.0.0.1:${srv.address().port}`;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let t, r, f;

  f = OUT + '/a.bin'; t = mk(U + '/file.bin', f); r = await run(SegmentedDownloader, t, 30000);
  ok('basic segmented download', r.res === 'completed' && h(fs.readFileSync(f)) === h(data), `${r.res} pct=${(t.downloadedBytes / t.totalBytes * 100).toFixed(1)}`);

  mode = 'steal'; f = OUT + '/b.bin'; t = mk(U + '/file.bin', f, 4); r = await run(SegmentedDownloader, t, 30000);
  ok('chunk stealing, no double download', r.res === 'completed' && h(fs.readFileSync(f)) === h(data) && r.maxPct <= 1.0001 && t.segments.length > 4, `segments=${t.segments.length} maxPct=${(r.maxPct * 100).toFixed(1)}%`);

  mode = 'normal'; f = OUT + '/c.bin'; fs.writeFileSync(f, Buffer.alloc(20 * 1024 * 1024, 7)); t = mk(U + '/file.bin', f); r = await run(SegmentedDownloader, t, 30000);
  ok('existing bigger file replaced cleanly', r.res === 'completed' && fs.statSync(f).size === data.length && h(fs.readFileSync(f)) === h(data));

  mode = 'liar'; f = OUT + '/d.bin'; t = mk(U + '/file.bin', f); r = await run(SegmentedDownloader, t, 30000);
  ok('server ignoring ranges -> single stream', r.res === 'completed' && h(fs.readFileSync(f)) === h(data), r.res);

  mode = 'normal'; slow = 20; f = OUT + '/e.bin'; t = mk(U + '/file.bin', f);
  r = await run(SegmentedDownloader, t, 30000, { pauseAt: 600 });
  const mid = t.downloadedBytes; slow = 0;
  r = await run(SegmentedDownloader, t, 30000);
  ok('pause then resume', r.res === 'completed' && mid > 0 && mid < data.length && h(fs.readFileSync(f)) === h(data) && t.downloadedBytes === data.length, `paused at ${(mid / data.length * 100).toFixed(0)}%`);

  mode = 'drop'; f = OUT + '/f.bin'; t = mk(U + '/file.bin', f); r = await run(SegmentedDownloader, t, 60000);
  ok('dropped connections retried', r.res === 'completed' && h(fs.readFileSync(f)) === h(data), r.res);

  mode = 'norange'; slow = 20; f = OUT + '/g.bin'; t = mk(U + '/file.bin', f);
  r = await run(SegmentedDownloader, t, 30000, { pauseAt: 400 }); slow = 0;
  r = await run(SegmentedDownloader, t, 30000);
  ok('non-resumable restart keeps counters right', r.res === 'completed' && t.downloadedBytes === data.length && r.maxPct <= 1.0001 && h(fs.readFileSync(f)) === h(data), `dl=${t.downloadedBytes}`);

  mode = 'normal'; f = OUT + '/h.bin'; t = mk(U + '/file.bin', f);
  const rl = new RateLimiter(4096); const t0 = Date.now(); r = await run(SegmentedDownloader, t, 30000, { rl });
  const secs = (Date.now() - t0) / 1000;
  ok('speed limit (4 MB/s)', r.res === 'completed' && secs > 2 && h(fs.readFileSync(f)) === h(data), `${secs.toFixed(1)}s for 12 MB`);

  t = mk(U + '/missing', OUT + '/i.bin'); r = await run(SegmentedDownloader, t, 15000);
  ok('404 reports an error', r.res.startsWith('error'), r.res);

  const exp = Buffer.concat(segs);
  f = OUT + '/h1.ts'; t = mk(U + '/master.m3u8', f); r = await run(HlsDownloader, t, 15000);
  ok('HLS master playlist -> best variant', r.res === 'completed' && h(fs.readFileSync(f)) === h(exp), r.res);

  hlsFail = { 2: 2 }; f = OUT + '/h2.ts'; t = mk(U + '/p.m3u8', f); r = await run(HlsDownloader, t, 20000);
  ok('HLS transient failure retried', r.res === 'completed' && h(fs.readFileSync(f)) === h(exp), r.res);

  hlsFail = { 3: -1 }; f = OUT + '/h3.ts'; t = mk(U + '/p.m3u8', f); r = await run(HlsDownloader, t, 20000);
  ok('HLS missing segment -> error, no hang', r.res.startsWith('error'), r.res); hlsFail = {};

  f = OUT + '/h4.ts'; t = mk(U + '/enc.m3u8', f); r = await run(HlsDownloader, t, 15000);
  ok('HLS AES-128 decryption', r.res === 'completed' && h(fs.readFileSync(f)) === h(exp), r.res);

  slow = 60; f = OUT + '/h5.ts'; t = mk(U + '/p.m3u8', f, 1);
  r = await run(HlsDownloader, t, 20000, { pauseAt: 1500 }); const idx = t.hlsIndex; slow = 0;
  r = await run(HlsDownloader, t, 15000);
  ok('HLS pause/resume', r.res === 'completed' && idx > 0 && idx < 6 && h(fs.readFileSync(f)) === h(exp), `paused at segment ${idx}`);

  ok('filename sanitizing blocks traversal',
    sanitizeFilename('..\\..\\AppData\\Startup\\evil.bat') === 'evil.bat' && sanitizeFilename('../../etc/passwd') === 'passwd' &&
    sanitizeFilename('CON') === 'download' && sanitizeFilename('a%2F..%2Fb.txt') === 'b.txt' && sanitizeFilename('..') === 'download');
  fs.writeFileSync(OUT + '/x.zip', '1');
  ok('unique file names', path.basename(uniqueFilePath(OUT, 'x.zip', [OUT + '/x (1).zip'])) === 'x (2).zip');
  ok('isInsideDir', isInsideDir(OUT, OUT + '/a') && !isInsideDir(OUT, OUT + '/../a'));

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.close();
  process.exit(fail ? 1 : 0);
});
