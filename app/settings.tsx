'use client';

import { useEffect, useRef, useState } from 'react';
import { BackupError, backupFilename, backupLabels, backupTables, exportHomeEnergy, serializeHomeEnergyBackup, type HomeEnergyBackup } from '../lib/backup/export-home-energy';

export function Settings() {
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<HomeEnergyBackup['counts'] | null>(null);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  async function download() {
    if (locked.current) return;
    locked.current = true;
    controller.current = new AbortController();
    setBusy(true); setCounts(null); setError('');
    try {
      const backup = await exportHomeEnergy({ signal: controller.current.signal });
      const json = serializeHomeEnergyBackup(backup);
      const filename = backupFilename(backup);
      if (!mounted.current || controller.current.signal.aborted) return;
      // No file/URL exists until every table and the complete backup validate.
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setCounts(backup.counts);
    } catch (error) {
      if (mounted.current) setError(error instanceof BackupError ? error.message : 'Backup failed. Unable to prepare or download the backup file.');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="settings-view">
    <div className="bill-panel">
      <h2>Data Backup</h2>
      <p className="backup-description">Download a copy of your Home Energy data. Keep it somewhere outside Supabase.</p>
      <button className="upload" type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Preparing backup…' : 'Download Backup'}</button>
      <p className="bill-note">Backup contains energy readings, observations, billing-cycle dates, and supporting import metadata.</p>
      {busy && <p className="bill-note" role="status">Preparing backup…</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {counts && <div className="backup-ready" role="status"><p>Backup ready</p><ul>{backupTables.map(table => <li key={table}>{counts[table].toLocaleString()} {backupLabels[table].toLowerCase()}</li>)}</ul></div>}
    </div>
  </section>;
}
