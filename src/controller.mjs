import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson } from './storage.mjs';
import { quote } from './herdr.mjs';
import { sessionRuns } from './model.mjs';
import { t, languageOf } from './i18n.mjs';

export function viewKey(socket, pane, session) {
  return createHash('sha256').update(JSON.stringify([socket, pane, session])).digest('hex').slice(0, 24);
}

export class DagPane {
  constructor({ sessionId, parentPane, socket, stateDir, cwd, node, viewer, herdr, notify = () => {}, language = 'en' }) {
    Object.assign(this, { sessionId, parentPane, cwd, node, viewer, herdr, notify });
    this.language = languageOf(language);
    this.key = viewKey(socket, parentPane, sessionId);
    this.stateFile = join(stateDir, `${this.key}.json`);
    this.recordFile = join(stateDir, `${this.key}.pane.json`);
    this.queue = Promise.resolve();
    this.runs = [];
    this.stopped = false;
  }

  enqueue(job) {
    const result = this.queue.then(job);
    this.queue = result.catch(error => this.notify(`DAG pane: ${error.message}`));
    return result;
  }

  receive(payload) {
    const runs = sessionRuns(payload, this.sessionId, this.language);
    if (runs === null || this.stopped) return Promise.resolve();
    return this.enqueue(async () => {
      this.runs = runs;
      await this.save(true);
      if (runs.length) await this.ensure(false);
    });
  }

  save(connected) {
    return writeJson(this.stateFile, { version: 1, sessionId: this.sessionId, connected, language: this.language,
      updatedAt: new Date().toISOString(), runs: this.runs });
  }

  open() {
    return this.enqueue(async () => {
      if (!this.runs.length) this.runs = (await readJson(this.stateFile))?.runs ?? [];
      await this.save(true);
      return this.ensure(true);
    });
  }

  async ensure(force) {
    const record = await readJson(this.recordFile);
    // Preserve a manually closed pane across events/reloads. /dag-pane explicitly reopens it.
    if (record && !force) return record.paneId;
    if (record?.paneId) {
      try {
        await this.herdr('get', record.paneId);
        if (record.ready) return record.paneId;
        // A failed launch might have left an occupied terminal. Never send text into it.
        throw new Error(t(this.language, 'incompletePane', { pane: record.paneId }));
      } catch (error) {
        // Only an explicit missing-pane response permits a replacement.
        const detail = `${error.message} ${error.stderr ?? ''}`;
        if (!/pane_not_found|unknown pane|pane .*not found/i.test(detail)) throw error;
      }
    }
    // Record an attempt before mutation: a timeout must not create repeated orphan panes.
    await writeJson(this.recordFile, { attempted: true });
    const result = await this.herdr('split', '--pane', this.parentPane, '--direction', 'right',
      '--ratio', '0.65', '--cwd', this.cwd, '--no-focus');
    const paneId = result?.pane?.pane_id;
    if (!paneId) throw new Error(t(this.language, 'missingPaneId'));
    await writeJson(this.recordFile, { paneId, ready: false });
    await this.herdr('rename', paneId, `DAG · ${this.sessionId.slice(0, 8)}`);
    await this.herdr('run', paneId, [this.node, this.viewer, '--state', this.stateFile, '--close-pane', paneId].map(quote).join(' '));
    await writeJson(this.recordFile, { paneId, ready: true });
    return paneId;
  }

  stop() {
    this.stopped = true;
    return this.enqueue(() => this.save(false));
  }
}
