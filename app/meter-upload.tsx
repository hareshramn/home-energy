'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { parseNationalGridCsv, type ParsedMeterFile } from '../lib/meter/parse-national-grid';
import { importMeterFile, latestMeterTimestamp, MeterImportError, type ImportCounts } from '../lib/meter/import-meter';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const formatTime = (timestamp: string) => dateTime.format(new Date(timestamp));
const parserErrors = new Set([
  'The CSV file is empty.',
  'The CSV file contains no meter rows.',
  'Unsupported CSV format. Choose a National Grid interval usage CSV.',
  'No recognizable National Grid CSV header was found.',
]);

type Result = { counts: ImportCounts; first: string | null; last: string | null; dstInvalidRows: number };

export function MeterUpload({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<ImportCounts | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [latestError, setLatestError] = useState('');
  const [checkingLatest, setCheckingLatest] = useState(false);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || locked.current) return;
    setError(''); setResult(null); setProgress(null); setLatest(null); setLatestError('');
    if (!/\.csv$/i.test(file.name)) { setError('Choose a .csv file.'); return; }
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setStage('Reading CSV…');
    let parsed: ParsedMeterFile;
    try {
      const text = await file.text();
      parsed = parseNationalGridCsv(text);
    } catch (error) {
      setError(error instanceof Error && parserErrors.has(error.message) ? error.message : 'Unable to read this CSV file. Please choose a readable National Grid CSV.');
      locked.current = false; setBusy(false); onBusyChange(false);
      return;
    }
    try {
      setStage('Importing readings…');
      const counts = await importMeterFile(file.name, parsed, setProgress);
      setResult({ counts, first: parsed.firstTimestamp, last: parsed.lastTimestamp, dstInvalidRows: parsed.dstInvalidRows });
      setCheckingLatest(true);
      try {
        setLatest(await latestMeterTimestamp());
      } catch {
        setLatestError('Unable to read the latest meter timestamp. Check household read permissions and your connection.');
      } finally {
        setCheckingLatest(false);
      }
    } catch (error) {
      if (error instanceof MeterImportError) {
        setError(error.interrupted
          ? `Import interrupted. ${error.message} Some readings may already be stored; none were removed. No automatic retry was attempted.`
          : `Import could not be created. ${error.message} If the request was interrupted, its outcome may be unknown. No automatic retry was attempted.`);
      } else {
        setError('Import interrupted. Some readings may already be stored. No automatic retry was attempted.');
      }
    } finally {
      locked.current = false; setBusy(false); onBusyChange(false);
    }
  }

  return <section className="meter-upload" aria-label="Import meter data" aria-busy={busy}>
    <input className="sr-only" ref={input} type="file" accept=".csv" tabIndex={-1} aria-label="Select CSV file" disabled={busy} onChange={event => void selectFile(event)}/>
    <button className="upload meter-select" type="button" disabled={busy} onClick={() => input.current?.click()}>SELECT CSV FILE</button>
    <p className="meter-help">Choose a National Grid CSV from your files. Import starts automatically.</p>
    {busy && !result && <p className="meter-processing" role="status">{stage}{progress ? ` ${progress.processed} / ${progress.validRows}` : ''}</p>}
    {error && <p className="auth-error meter-error" role="alert">{error}</p>}
    {error && progress && <p className="meter-help">Confirmed before interruption: {progress.inserted} new, {progress.duplicate} already stored, {progress.conflict} conflicts, {progress.invalid} invalid. This import is incomplete.</p>}
    {result && <div className="meter-result">
      <h2 role="status">Import complete</h2>
      <p>{result.counts.rowsReceived} readings received</p>
      <dl className="meter-counts">
        <div><dt>New</dt><dd>{result.counts.inserted}</dd></div>
        <div><dt>Already stored</dt><dd>{result.counts.duplicate}</dd></div>
        <div className={result.counts.conflict ? 'meter-conflicts' : ''}><dt>Conflicts</dt><dd>{result.counts.conflict}</dd></div>
        <div><dt>Invalid</dt><dd>{result.counts.invalid}</dd></div>
      </dl>
      {result.counts.conflict > 0 && <p className="meter-conflict-note">Conflicting readings were flagged. Existing readings were kept.</p>}
      {result.dstInvalidRows > 0 && <p className="meter-help">{result.dstInvalidRows} ambiguous or nonexistent Eastern-time readings were rejected.</p>}
      <div className="meter-coverage"><h3>Coverage</h3><p>{result.first && result.last ? <>{formatTime(result.first)}<br/><span aria-hidden="true">→ </span>{formatTime(result.last)}</> : 'No valid meter timestamps.'}</p></div>
      <div className="meter-coverage"><h3>Latest meter reading</h3>{checkingLatest ? <p role="status">Checking…</p> : latestError ? <p className="auth-error" role="alert">{latestError}</p> : <p>{latest ? formatTime(latest) : 'No meter readings available.'}</p>}</div>
    </div>}
  </section>;
}
