import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { DagPane } from './src/controller.mjs';
import { createHerdr } from './src/herdr.mjs';
import { resolveViewerNode } from './src/runtime.mjs';
import { t, languageOf } from './src/i18n.mjs';

export default function extension(pi) {
  if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_PANE_ID || !process.env.HERDR_SOCKET_PATH) return;
  let installedLanguage = 'en';
  try { installedLanguage = JSON.parse(readFileSync(new URL('./locale.json', import.meta.url), 'utf8')).language; }
  catch (error) { if (error.code !== 'ENOENT') console.warn(`DAG pane: Cannot read locale configuration: ${error.message}`); }
  const language = languageOf(process.env.OMO_HERDR_DAG_LANG ?? installedLanguage);
  let controller;
  let unsubscribe;
  const viewer = join(dirname(fileURLToPath(import.meta.url)), 'src/viewer.mjs');
  const stateDir = process.env.OMO_HERDR_DAG_STATE_DIR ?? join(homedir(), '.omo', 'agent', 'herdr-dag');

  async function stop() {
    unsubscribe?.();
    unsubscribe = undefined;
    await controller?.stop();
    controller = undefined;
  }

  pi.on('session_start', async (_event, ctx) => {
    await stop();
    // In-process child agents inherit the parent pane environment, but do not own its UI.
    if (/[/\\]senpi-task[/\\]children[/\\]/.test(ctx.sessionManager.getSessionFile?.() ?? '')) return;
    controller = new DagPane({ sessionId: ctx.sessionManager.getSessionId(),
      parentPane: process.env.HERDR_PANE_ID, socket: process.env.HERDR_SOCKET_PATH,
      stateDir, cwd: pi.cwd, node: () => resolveViewerNode({ language }), viewer, herdr: createHerdr(), language,
      notify: message => ctx.ui.notify(message, 'warning') });
    // Confirmed in senpi/dist/core/event-bus.js and extensions/loader.js:
    // pi.rpc.emit forwards {name, data} through this shared event channel.
    unsubscribe = pi.events.on('senpi:extension-rpc-event', event => {
      if (event?.name !== 'omo.dag.updated') return;
      try { void controller?.receive(event.data).catch(() => {}); }
      catch (error) { ctx.ui.notify(`DAG pane: ${error.message}`, 'warning'); }
    });
  });
  pi.on('session_shutdown', stop);
  pi.registerCommand('dag-pane', {
    description: t(language, 'commandDescription'),
    handler: async (_args, ctx) => {
      if (!controller) return ctx.ui.notify(t(language, 'unavailable'), 'warning');
      await controller.open().catch(() => {});
    },
  });
}
