# Contributing

Bug reports and pull requests are welcome. Keep changes focused, describe the behavior they change, and keep [README.md](README.md) and [README_KO.md](README_KO.md) consistent for user-facing changes.

## Local development

Use Node 24 or later. The installed product has no npm dependencies. Run `npm ci --ignore-scripts` to obtain the development-only Windows PTY bridge (its Windows prebuild is included).

```bash
npm test
npm run build
npm run test:package
```

The deterministic tests cover snapshot normalization, session isolation, pane reuse, failure handling, graph layout, scrolling, and terminal display widths. They do not require OmO or Herdr. Add behavior tests for fixes that affect these contracts.

On POSIX, the interactive viewer test requires Python 3 and a Unix PTY. On Windows it uses `node-pty` with real ConPTY input and resize events, tapping the viewer's complete output frames before ConPTY converts them into differential terminal updates. Both bridges wait for frame predicates rather than fixed delays. These are test-only requirements; the installed extension and viewer still require only Node. The test covers node selection, default expansion, collapse/expand, state updates, resizing, and preference persistence across restarts. Windows store tests use privilege-free hard links; POSIX also tests symbolic links.

The build assembles `dist/` and checks JavaScript syntax. The package check installs the real npm tarball offline into a temporary project and verifies the public CLI. `npm run check` runs the complete local pipeline. Generated files in `dist/` and `.artifacts/` should not be committed.

English is the default interface language. Keep English and Korean entries in `src/i18n.mjs` complete, and preserve workflow-provided labels in their original language. Test both the fresh-install default and explicit `--lang ko` selection.

## Installed OmO integration check

If OmO is globally installed through npm, run this from the project root:

```bash
OMO_PACKAGE_ROOT="$(npm root -g)/omo-ai"
node scripts/verify-native.mjs "$OMO_PACKAGE_ROOT"
```

For another installation method, set `OMO_PACKAGE_ROOT` to the directory containing OmO's `package.json`, `plugin/`, and `node_modules/`.

This check uses the installed Senpi loader and RPC event bus. It supplies a mock Herdr environment and empty DAG snapshots, so it does not contact Herdr or create panes. It also checks the known OmO beta.42 event projection in the installed bundle. Its source assertions are specific to that build; a failure after an OmO upgrade needs inspection before claiming compatibility.

To verify the installed extension entry point:

```bash
node scripts/verify-native.mjs "$OMO_PACKAGE_ROOT" \
  --extension "$HOME/.omo/agent/extensions/herdr-dag.js"
```

For installer changes, test a temporary `--agent-dir` before installing into your active OmO environment. Check both a new installation and an update, and verify that unrelated files and runtime records remain intact.

## Manual live-pane check

Run this only from a real Herdr pane in a layout where you want a temporary sibling pane. It opens a viewer using an explicitly labeled synthetic example; it does not execute model workers or a workflow.

```bash
node scripts/verify-native.mjs "$OMO_PACKAGE_ROOT" --live
```

The result includes `paneId` and `stateDir`. Record the layout before and after, confirm that the original pane keeps focus, and inspect the new viewer. Its disconnected indicator is expected because the verifier drains the event queue and shuts down its test extension.

To send a completed snapshot to the same viewer, substitute the returned state directory:

```bash
node scripts/verify-native.mjs "$OMO_PACKAGE_ROOT" \
  --live --state-dir /path/to/returned/state-directory --complete
```

Check that the same pane updates to five completed nodes. Use `q` in the viewer to close the generated pane when finished. Do not close unrelated panes or run these checks against another person's active session.

For release compatibility claims, also test a real OmO workflow on an unmodified Herdr installation without custom OmO agent registration. Record the actual OS, runtime versions, and observed behavior in [VERIFICATION.md](VERIFICATION.md). A remote Linux host accessed from a Mac does not verify native macOS support. Configuring a CI matrix is not evidence that those jobs have run.

## Implementation boundaries

- `extension.mjs`: OmO lifecycle and Senpi event subscription.
- `src/model.mjs`: Normalize explicit DAG snapshots and compute topological layers.
- `src/controller.mjs`: Serialize updates and manage session-specific pane records.
- `src/herdr.mjs`: Call the Herdr pane CLI with explicit targets.
- `src/storage.mjs`: Replace local JSON state atomically.
- `src/task-data.mjs`: Read OmO task records and progress events, retaining only DAG-linked tasks and their explicit descendants.
- `src/view-state.mjs`: Persist session/run/node expansion preferences separately from workflow snapshots.
- `src/render.mjs` and `src/viewer.mjs`: Terminal layout, file watching, and keyboard controls.
- `scripts/install.mjs`: Install a standalone copy in the OmO agent directory.
- `src/i18n.mjs`: English and Korean interface messages.
- `bin/omo-herdr-dag.mjs`: Public npm installer CLI.
- `scripts/build.mjs` and `scripts/verify-package.mjs`: Build and verify the npm distribution.

Do not infer task dependencies or display another session's runs. Keep graph data out of shell command strings. Sanitize terminal control sequences in user-supplied labels and errors. Preserve user focus and respect a manually closed viewer.

## Reporting bugs

Include the actual host OS, Node version, OmO/Senpi version, Herdr version or protocol, and whether Herdr has customizations. Provide a minimal reproduction and sanitized output. Never include real workflow prompts, complete session files, credentials, or private runtime snapshots.

## License

Release and publication instructions are in [RELEASING.md](RELEASING.md).

By submitting a contribution, you agree that your contribution is licensed under this project's [MIT License](LICENSE).
