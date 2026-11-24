import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, File as FileGlyph, Film, FolderOpen, Loader2, Magnet, Radio } from 'lucide-react';
import { NewDownloadRequest, VideoFormatOption } from '../types';
import { classifyLink, friendlyIpcError, LinkKind, nameFromLink } from '../lib/format';

const FALLBACK_FORMATS: VideoFormatOption[] = [
  { formatId: 'bv*+ba/b', resolution: 'Best', quality: 'Best', ext: 'mp4', label: 'Best available quality' },
  { formatId: 'bv*[height<=1080]+ba/b', resolution: '1080p', quality: '1080p', ext: 'mp4', label: '1080p Full HD' },
  { formatId: 'bv*[height<=720]+ba/b', resolution: '720p', quality: '720p', ext: 'mp4', label: '720p HD' },
  { formatId: 'ba/b', resolution: 'Audio', quality: 'Audio MP3', ext: 'mp3', label: 'Audio only (MP3)' },
];

const KIND_TEXT: Record<LinkKind, { icon: React.FC<any> | null; text: string; ok: boolean }> = {
  empty: { icon: null, text: 'Paste a web link, a video page or a magnet link.', ok: false },
  invalid: { icon: AlertCircle, text: 'This doesn’t look like a link that can be downloaded.', ok: false },
  file: { icon: FileGlyph, text: 'File link: downloads over several connections at once.', ok: true },
  video: { icon: Film, text: 'Video page: pick a quality below.', ok: true },
  stream: { icon: Radio, text: 'Live-stream playlist: saved as one MP4 file.', ok: true },
  torrent: { icon: Magnet, text: 'Torrent: downloads from other peers.', ok: true },
};

function splitLinks(text: string): string[] {
  return Array.from(new Set(text.split(/\s+/).map((s) => s.trim()).filter(Boolean)));
}

export interface AddDownloadFormProps {
  initial?: Partial<NewDownloadRequest> | null;
  defaultDir: string;
  onDone: (count: number) => void;
  onCancel: () => void;
  onError?: (message: string) => void;
}

export const AddDownloadForm: React.FC<AddDownloadFormProps> = ({ initial, defaultDir, onDone, onCancel }) => {
  const api = window.quantumApi;
  const [text, setText] = useState(initial?.url || '');
  const [filename, setFilename] = useState(initial?.filename ? initial.filename.split(/[\\/]/).pop() || '' : '');
  const [dir, setDir] = useState(defaultDir);
  const [formats, setFormats] = useState<VideoFormatOption[] | null>(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [formatId, setFormatId] = useState<string | undefined>(initial?.formatId);
  const [probing, setProbing] = useState(false);
  const [probeNote, setProbeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const probeSeq = useRef(0);

  useEffect(() => setDir(defaultDir), [defaultDir]);

  // When new data arrives (pop-up window reused), reset the form
  useEffect(() => {
    setText(initial?.url || '');
    setFilename(initial?.filename ? initial.filename.split(/[\\/]/).pop() || '' : '');
    setFormatId(initial?.formatId);
    setFormats(null);
    setError('');
  }, [initial]);

  const links = useMemo(() => splitLinks(text), [text]);
  const single = links.length <= 1;
  const kind: LinkKind = links.length === 0 ? 'empty' : single ? classifyLink(links[0]) : 'file';
  const invalidCount = links.filter((l) => classifyLink(l) === 'invalid').length;
  const isVideo = single && kind === 'video';

  // Read the available qualities for a video page
  useEffect(() => {
    if (!isVideo || !api) {
      setFormats(null);
      return;
    }
    const seq = ++probeSeq.current;
    const url = links[0];
    setProbing(true);
    setProbeNote('');
    const t = setTimeout(async () => {
      try {
        const r = await api.probeFormats(url);
        if (seq !== probeSeq.current) return;
        if (r.ok && r.formats?.length) {
          setFormats(r.formats);
          setVideoTitle(r.title || '');
          setFormatId((cur) => (cur && r.formats!.some((f) => f.formatId === cur) ? cur : r.formats![0].formatId));
        } else {
          setFormats(FALLBACK_FORMATS);
          setFormatId((cur) => cur || FALLBACK_FORMATS[0].formatId);
          setProbeNote(r.error ? 'Couldn’t read the exact qualities, so common ones are shown.' : '');
        }
      } finally {
        if (seq === probeSeq.current) setProbing(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, links[0]]);

  const suggestedName = single && links[0] ? (isVideo ? videoTitle : nameFromLink(links[0])) : '';
  const chosen = formats?.find((f) => f.formatId === formatId);

  const browse = async () => {
    const picked = await api?.selectDownloadFolder();
    if (picked) setDir(picked);
  };

  const submit = async (startNow: boolean) => {
    if (!api || busy) return;
    const valid = links.filter((l) => classifyLink(l) !== 'invalid');
    if (!valid.length) {
      setError(links.length ? 'None of these are links that can be downloaded.' : 'Paste a link first.');
      return;
    }
    setBusy(true);
    setError('');
    const failures: string[] = [];
    let added = 0;
    for (const url of valid) {
      const req: NewDownloadRequest = {
        url,
        directory: dir && dir !== defaultDir ? dir : undefined,
      };
      if (single) {
        const name = filename.trim() || (isVideo ? videoTitle : '');
        if (name) req.filename = name;
        req.headers = initial?.headers;
        req.category = initial?.category;
      }
      if (single && isVideo) {
        req.formatId = formatId || 'bv*+ba/b';
        req.quality = chosen?.ext === 'mp3' ? 'audio' : chosen?.quality;
      }
      try {
        const res = await api.addDownload(req);
        if (res.ok) {
          added++;
          if (!startNow) await api.pauseDownload(res.task.id);
        } else failures.push(res.error);
      } catch (e) {
        failures.push(friendlyIpcError(e));
      }
    }
    setBusy(false);
    if (failures.length && !added) {
      setError(failures[0]);
      return;
    }
    onDone(added);
  };

  const K = KIND_TEXT[kind];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
      style={{ display: 'contents' }}
    >
      <div className="dialog-body">
        <div className="field">
          <label className="field-label" htmlFor="qd-links">
            {single ? 'Link' : `${links.length} links`}
          </label>
          <textarea
            id="qd-links"
            className={`input${kind === 'invalid' ? ' invalid' : ''}`}
            rows={single ? 2 : 4}
            value={text}
            placeholder="https://example.com/file.zip"
            spellCheck={false}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey) && single) {
                e.preventDefault();
                submit(true);
              }
            }}
          />
          <div className={`link-kind${K.ok ? ' ok' : ''}`}>
            {K.icon && <K.icon />}
            <span>
              {single ? K.text : `Each link becomes its own download.${invalidCount ? ` ${invalidCount} can’t be downloaded and will be skipped.` : ''}`}
            </span>
          </div>
        </div>

        {isVideo && (
          <div className="field">
            <span className="field-label">Quality</span>
            {probing && !formats ? (
              <div className="link-kind">
                <Loader2 className="spin" />
                <span>Reading available qualities…</span>
              </div>
            ) : (
              <div className="choice-list" role="radiogroup" aria-label="Quality">
                {(formats || FALLBACK_FORMATS).map((f) => (
                  <button
                    type="button"
                    key={f.formatId}
                    className="choice"
                    aria-pressed={f.formatId === formatId}
                    onClick={() => setFormatId(f.formatId)}
                  >
                    <span className="radio" />
                    {f.label.split(' · ')[0]}
                    {f.label.includes(' · ') && <small>{f.label.split(' · ')[1]}</small>}
                  </button>
                ))}
              </div>
            )}
            {probeNote && <span className="field-hint">{probeNote}</span>}
          </div>
        )}

        {single && kind !== 'empty' && kind !== 'invalid' && (
          <div className="field">
            <label className="field-label" htmlFor="qd-name">
              Save as
            </label>
            <input
              id="qd-name"
              className="input"
              value={filename}
              spellCheck={false}
              placeholder={suggestedName || 'Name from the server'}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <span className="field-label">Folder</span>
          <div className="input-row">
            <input className="input" value={dir} readOnly title={dir} aria-label="Download folder" />
            <button type="button" className="btn" onClick={browse}>
              <FolderOpen />
              Change
            </button>
          </div>
        </div>

        {error && (
          <p className="field-error" role="alert" style={{ marginTop: 14 }}>
            {error}
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" disabled={busy || kind === 'empty'} onClick={() => submit(false)}>
          Add paused
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || kind === 'empty' || (single && kind === 'invalid')}>
          {busy ? <Loader2 className="spin" /> : null}
          {single ? 'Download' : `Download ${links.length - invalidCount}`}
        </button>
      </div>
    </form>
  );
};
