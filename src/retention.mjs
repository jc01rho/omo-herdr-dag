import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Session snapshots accumulate one file family per OmO session in the state
// directory. Startup retention prunes entries whose last modification is older
// than the configured number of days, always sparing the current session.
export function retentionDaysFromEnv(env = process.env) {
  const raw = env.OMO_HERDR_DAG_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === '') return 14;
  const days = Number(raw);
  // Zero or invalid values disable pruning instead of deleting everything.
  if (!Number.isFinite(days) || days <= 0) return 0;
  return days;
}

export async function pruneExpiredSnapshots(directory, { keepFiles = [], now = Date.now(), days, notify = () => {} } = {}) {
  if (!(days > 0)) return;
  let files;
  try { files = await readdir(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return; }
  const deadline = now - days * 86400000;
  for (const file of files) {
    // Only managed snapshot families: state, pane records, view preferences, temp leftovers.
    if (!file.endsWith('.json') && !file.endsWith('.tmp')) continue;
    // A long-lived session's own pane record must survive pruning, or its pane
    // would be torn down and reopened on the next background event.
    if (keepFiles.includes(file)) continue;
    const path = join(directory, file);
    try {
      const info = await stat(path);
      if (info.mtimeMs > deadline) continue;
      await rm(path, { force: true });
    } catch (error) {
      // Another session's startup may prune the same file first; that race is benign.
      if (error.code !== 'ENOENT') notify(`${error.message}`);
    }
  }
}
