import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { NewDownloadRequest } from '../types';
import { AddDownloadForm } from './AddDownloadForm';
import { BrandMark } from './ui';
import { useTheme } from '../lib/theme';

/** Small always-on-top window shown when the browser or clipboard hands us a link. */
export const StandaloneDialog: React.FC = () => {
  const api = window.quantumApi;
  const [data, setData] = useState<Partial<NewDownloadRequest> | null>(null);
  const [dir, setDir] = useState('');
  const [theme, setTheme] = useState('light');
  const [note, setNote] = useState('');
  useTheme(theme);

  useEffect(() => {
    if (!api) return;
    api.getSettings().then((s) => {
      setDir(s.downloadDir);
      setTheme(s.theme);
    });
    api.getDialogData().then((d) => d && setData({ ...d }));
    const off = api.on('init-dialog-data', (d) => {
      setNote('');
      setData({ ...(d || {}) });
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && api.closeDialog();
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, [api]);

  return (
    <div className="standalone">
      <div className="standalone-head">
        <BrandMark />
        New download
        <button className="icon-btn" aria-label="Close" onClick={() => api?.closeDialog()}>
          <X />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
        {note ? (
          <div className="dialog-body">{note}</div>
        ) : (
          <AddDownloadForm
            initial={data}
            defaultDir={dir}
            onCancel={() => api?.closeDialog()}
            onDone={() => api?.closeDialog()}
          />
        )}
      </div>
    </div>
  );
};
