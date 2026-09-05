# OmO Herdr DAG

**Live OmO workflow DAGs in a Herdr side pane.**

English | [한국어](README_KO.md)

`omo-herdr-dag` is an [OmO](https://github.com/code-yeongyu/oh-my-openagent) extension that opens a dedicated TUI in [Herdr](https://herdr.dev/) when a workflow DAG appears. Follow dependencies and node states beside your conversation, with focus kept in the original pane.

```text
                 [Analyze ✓]
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
     [Server ●]                [UI ●]
          │                       │
          └───────────┬───────────┘
                      ▼
                [Integrate ○]
                      │
                      ▼
                 [Verify ○]
```

Illustrative layout. The interface defaults to English; Korean is available with `--lang ko`. Node labels come from your workflow and are displayed unchanged.

## Features

- Opens a right-hand pane using about 35% of the original pane's width.
- Updates node states and dependencies from OmO workflow snapshots.
- Reuses the session's pane across updates and extension reloads.
- Keeps completed and failed runs visible after the session ends.
- Supports scrolling and switching between runs.
- Respects manual closure: use `/dag-pane` to reopen the viewer.
- Uses Node built-ins, with no npm dependencies or changes to the OmO package.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 24 or later. Tested with 24.14.0 and 26.7.0. |
| OmO | A version exposing the `omo.dag.updated` event. Verified with `5.0.0-0.beta.42` and Senpi `2026.9.4-3`. |
| Herdr | Installed, running, and available as `herdr` on `PATH`; must support the pane commands described below. Integration tested against protocol 20. |
| Terminal | Run OmO inside a Herdr pane, with a UTF-8 terminal and font that supports box-drawing characters. |

**Custom OmO agent registration in Herdr is not required by this extension.** Open a normal Herdr terminal pane and run `omo` yourself. The extension uses pane IDs and ordinary `herdr pane` commands; it does not call `herdr agent start` or depend on sidebar agent recognition.

The architecture supports that setup, but a clean, unmodified Herdr installation has **not yet been verified end to end**. See [verification and compatibility](VERIFICATION.md) for the exact coverage. Native macOS and Windows support is also unverified.

## Install

Install OmO and Herdr separately first. This project is prepared for npm distribution; the initial npm release has not been published yet.

### From npm (after the first release)

```bash
npx omo-herdr-dag@latest install --dry-run
npx omo-herdr-dag@latest install
```

The first installation defaults to English. To choose Korean:

```bash
npx omo-herdr-dag@latest install --lang ko
```

To explicitly select English, including when switching back from Korean, use `npx omo-herdr-dag@latest install --lang en`. Updates keep the saved language unless you select another one.

You can also install the CLI globally with `npm install -g omo-herdr-dag`, then run `omo-herdr-dag install`. Fetching the npm package alone does not modify your OmO configuration; the explicit `install` command copies the extension into place. Herdr and OmO remain separate prerequisites.

### From source (available now)

Clone this repository and run the installer:

```bash
git clone https://github.com/jc01rho/omo-herdr-dag.git
cd omo-herdr-dag
npm test
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

There are no npm dependencies. `--dry-run` prints the destinations without changing files. The source installer also accepts `--lang en` or `--lang ko`.

The installer creates:

```text
~/.omo/agent/
├── extensions/herdr-dag.js          # Extension entry point
└── herdr-dag/integration/           # Installed extension and viewer
```

Start a new OmO session inside Herdr, or run `/reload` in an existing session. The first workflow DAG snapshot opens the viewer automatically. You can also run `/dag-pane` in OmO to open an empty viewer while waiting for a DAG.

### Custom agent directory

If your OmO installation loads extensions from a different agent directory:

```bash
node scripts/install.mjs --agent-dir /path/to/your/agent-directory
```

This changes the installation destination. It does not configure OmO's extension discovery or change the default runtime state directory.
The npm CLI accepts the same `--agent-dir` option.

## Controls

| Where | Command or key | Action |
| --- | --- | --- |
| OmO | `/dag-pane` | Open or reopen the current session's viewer. |
| OmO | `/reload` | Load or reload the extension. |
| DAG pane | `↑` / `↓`, `k` / `j` | Scroll. |
| DAG pane | `Page Up` / `Page Down` | Scroll by a page. |
| DAG pane | `←` / `→` | Switch between runs. |
| DAG pane | `q`, `Ctrl+C`, `Ctrl+D` | Close the viewer and its generated pane. |

When the OmO session ends, the last graph remains visible with a disconnected indicator and an explicit close hint:

```text
○ Disconnected · snapshot saved
You can close this pane with q.
```

You may keep the snapshot open for reference or press `q` to close the viewer and its generated pane. Closing the viewer does not cancel workflow tasks or delete the saved snapshot. The close hint appears only while disconnected; it does not mean every workflow task completed successfully.

## Configuration and local data

| Variable | Default | Purpose |
| --- | --- | --- |
| `OMO_HERDR_DAG_STATE_DIR` | `~/.omo/agent/herdr-dag/` | Directory for snapshots and pane records. Set before starting OmO. |
| `OMO_HERDR_DAG_LANG` | Saved installation language, initially `en` | Override the interface language with `en` or `ko`. Set before starting OmO or reloading the extension. |

`install --lang ko` saves the selection in the installed `integration/locale.json`. Updates retain that choice unless you pass another `--lang` value. Use `install --lang en` to switch back to English. The environment override takes precedence; unsupported override values fall back to English.

Herdr supplies `HERDR_ENV`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH` to its panes. Outside that environment, the extension stays inactive. Do not set those variables manually to target another pane.

Snapshots are local JSON files. They contain session and run IDs, names, node labels, states, task IDs, dependency edges, and error messages. Workflow prompts are omitted, but labels and errors may still contain project information. Keep runtime files out of public issue reports and source control. The extension adds no external network service or telemetry.

## Update and uninstall

To update after npm publication, run `npx omo-herdr-dag@latest install` again. For a source installation, obtain the new source and rerun the installer. It backs up the previous integration directory and preserves runtime records and your language choice. The installed copy is independent of the source checkout or npm cache. Run `/reload` in existing OmO sessions afterward.

To uninstall, remove `~/.omo/agent/extensions/herdr-dag.js`, then reload or restart OmO. Close any existing DAG panes yourself. You may keep `~/.omo/agent/herdr-dag/` as a record, or remove it separately. For a custom installation, remove the entry point from that agent directory instead.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/dag-pane` is unavailable | Reload OmO, confirm the extension was installed in its active agent directory, and confirm OmO is running inside Herdr. |
| No pane opens automatically | This extension displays **workflow DAGs**. Ordinary tasks and generic `parallel()` calls do not necessarily produce the required event. Check the OmO version. |
| A pane was closed and stays closed | This is intentional. Run `/dag-pane` to reopen it. |
| A `DAG pane:` warning appears | Confirm `herdr` is on `PATH` and supports `pane split`, `get`, `rename`, and `run`. A failed or uncertain launch suppresses automatic retries to avoid duplicate panes. Inspect and close any incomplete viewer pane before retrying. |
| An edge is hard to follow | Inspect the incoming IDs inside each node and the complete edge list below the graph. Scroll if necessary. |

## How it works

```text
OmO workflow snapshot: omo.dag.updated
    → Senpi shared event bus: senpi:extension-rpc-event
    → Filter by the current parent session ID
    → Write a normalized local snapshot
    → Open/reuse a Herdr pane; its TUI watches the snapshot file
```

The bridge listens to the installed Senpi event bus. It uses `herdr pane split --ratio 0.65 --no-focus`, `rename`, and `run` to create the viewer. Herdr's ratio refers to the original pane, leaving approximately 35% for the new pane.

This integration depends on OmO/Senpi internal event contracts, which may change between versions. It reads explicit workflow edges; it does not infer dependencies between unrelated tasks. Wide frontiers wrap, and dependencies that skip a frontier are represented by incoming IDs and the edge list. Long labels and errors are clipped to the terminal width.

## Development

```bash
npm test
npm run build
npm run test:package
```

The tests run without OmO or Herdr and use temporary local files and mocked pane commands. `build` assembles the dependency-free JavaScript distribution in `dist/` and checks its syntax. `test:package` packs it, installs the tarball offline in a temporary project, and verifies the CLI, installation, updates, and language selection. `npm run check` runs all three steps.

GitHub Actions runs these checks on Node 24 and 26 on Linux, then uploads an npm `.tgz` artifact. Installed-runtime and manual live-pane checks are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

## Distribution

GitHub hosts the source and CI artifacts. The npm registry will distribute the versioned CLI and extension package after publication. The installer copies the runtime files into your OmO agent directory, where they run locally; this project needs no hosted application server. A downloaded CI tarball can be installed with `npm install -g ./omo-herdr-dag-1.0.0.tgz`, followed by `omo-herdr-dag install`.

Creating a Git tag or pushing this repository does not publish to npm. Maintainer publishing steps are in [RELEASING.md](RELEASING.md).

Contributions, compatibility reports, and improvements to terminal rendering are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

[MIT](LICENSE). This is an independent community extension, not an official OmO or Herdr component.
