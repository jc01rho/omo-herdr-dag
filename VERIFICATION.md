# Verification and compatibility

This record separates observed behavior from integration assumptions. The baseline checks below were performed on 2026-09-05 before public release.

## Tested environments

| Environment | Observed coverage |
| --- | --- |
| Linux x86_64, Node 24.14.0 | 10 behavior tests passed; installed Senpi loader and RPC bus passed; live Herdr pane creation, rendering, updates, focus preservation, and cleanup verified. |
| Two additional Linux x86_64 hosts, Node 26.7.0 | 10 behavior tests passed on each host; source and installed extension entry points passed installed-loader and RPC bus checks. No live panes were created on those hosts. |
| OmO `5.0.0-0.beta.42`, Senpi `2026.9.4-3` | The snapshot producer, RPC projection, and shared event bus contract were inspected in the installed packages. |
| Herdr protocol 20 | Its pane CLI was exercised in an environment with custom OmO agent reporting. |
| Native macOS 15.8 (24H23) arm64, Node 24.21.0, OmO `5.0.1`, Senpi `2026.9.27`, Herdr 0.9.1 (protocol 22) | 98 tests, the syntax-checking build, and the offline package smoke check passed. Simplified Chinese was exercised end to end through the real OmO path: pane creation, live task card, focus preservation, disconnected snapshot, and `q` cleanup. The scripted verifier does not run against this OmO build. |

## Observed behavior

- A five-node example with five explicit edges rendered its split and merge structure in a real Herdr pane.
- The source pane retained focus. In a 162-column layout, the source pane received 105 columns and the viewer received 57 columns with `--ratio 0.65`.
- Repeated synthetic events reused the same pane. A subsequent completed snapshot updated all five nodes in that viewer, confirmed by Herdr's output matching command.
- Shutting down the test extension left the final graph visible with a disconnected indicator.
- Pressing `q` closed the generated viewer pane and restored the source pane's width. All temporary viewer panes were cleaned up.
- The copied installation loaded independently through its generated extension entry point.

The live check used the actual Senpi loader and `pi.rpc.emit()` with an explicitly labeled **synthetic DAG snapshot**. It did not execute model workers or a real workflow. Unit tests used mocked pane commands; these are not evidence of stock Herdr compatibility.

## Version 1.1.0 verification

On 2026-09-06, Linux x86_64 with Node 24.14.0 passed 65 tests with the optional real Bun/Senpi loader check enabled, followed by the build and offline npm package smoke check. Coverage includes standalone subtasks, default-expanded details, persistent per-task and per-node preferences, checkpoint recovery, terminal-state metadata, and generation-isolated installation. The real loader regression verifies changed transitive modules after reinstalling within the same Bun process.

In the active Herdr session, the updated extension recovered a saved completed DAG with four nodes and their task details. Ten current-session tasks were collected, including six ordinary tasks outside that DAG. The live viewer displayed the linked task ID, description, agent/model, duration and counters; switching between DAG and Tasks, collapsing a standalone task, checking its persisted preference, and expanding it again were exercised. This verified recovery of an existing real workflow, not a fresh end-to-end workflow or nested-child launch.

## Windows local verification (2026-09-06)

Windows 11 x64 (build 26200), Node 26.7.0, npm 12.0.2, Windows PowerShell 5.1, and Herdr 0.8.2 passed 72 tests with no skips, the syntax-checking build, and offline npm package installation/CLI checks. Windows tests use a real ConPTY bridge for keyboard input, resize, snapshot refresh, preference persistence, and the elapsed clock. PowerShell regression tests execute the controller's actual command with spaces and apostrophes in paths; a Bash subprocess also verifies the unchanged POSIX quoting contract.

The installed viewer recovered an actual completed three-node workflow created by OmO beta.43 / Senpi 2026.9.5. A dedicated Herdr pane displayed both start nodes, their merge into the verification node, all three completed states, both explicit dependency edges, and Korean task details. The original pane retained focus (98 columns, viewer 52 columns). Space collapsed a node and Enter expanded it through Herdr's real input API. The dedicated verifier shut down its controller, so the viewer correctly retained a disconnected snapshot. No new model workflow was launched for this check.

The active installed runtime was byte-compared with the source. Installation selects the active agent-directory environment variables rather than always writing under `~/.omo/agent`. Existing OmO sessions still require `/reload`; close any old failed viewer and use `/dag-pane` to reopen. The optional standalone installed-Senpi loader verifier timed out while importing Senpi, under both Node and Bun; that Windows loader check is **not verified**. Language-server initialization lacked TypeScript, so JavaScript syntax checks covered all 30 source, script, and test modules instead.

## Version 1.1.1 verification

The compact-card update passed 72 tests on Linux x86_64 with Node 24.14.0 and the optional real Bun/Senpi loader check enabled. Expanded cards use four lines; `d` temporarily shows full selected details. Event-driven real PTY tests cover standalone and DAG status transitions, automatic expansion only while running, automatic folding on completion, persistent manual overrides, and restarting without persisting temporary detail views. The build and offline package check also passed.

The active Herdr viewer was updated in place. Its running generation and installed automatic-expansion policy were confirmed, as were compact/full-detail switching and preservation of saved fold preferences. Real business tasks were not modified to manufacture state transitions; transition coverage uses synthetic snapshots through the actual viewer PTY. No new pixel-level visual approval is claimed for this update.

## Version 1.2.0 verification

The Windows PowerShell port and follow-up error-preservation fix passed 80 tests on Linux, the build, and offline package verification. The reviewed PR head also passed GitHub-hosted Node 24 and 26 checks. Independent probes verified POSIX literal argv, Windows command construction, simulated Windows sharing-error retry bounds, previous-snapshot retention, and temporary cleanup. When cleanup itself fails, the original write error remains primary and the cleanup error is exposed as its cause.

Native PowerShell and ConPTY were not rerun by the Linux reviewer; those results remain limited to the contributor's Windows environment described above. Windows development tests require Bash on PATH in addition to the development-only ConPTY bridge. These requirements do not add runtime npm dependencies to the installed viewer. English README screenshots were updated in the same integrated source baseline.

## Simplified Chinese verification on native macOS (2026-09-29)

macOS 15.8 (build 24H23) on arm64 (Apple M3), Node 24.21.0, OmO 5.0.1, Senpi 2026.9.27, and Herdr 0.9.1 at protocol 22, with an **unmodified** Herdr: no custom OmO agent registration was added, and Herdr's integrations page listed only its own built-in agents.

`npm run check` passed 98 tests, the syntax-checking build, and the offline npm package smoke check. That smoke check now also asserts the explicit `--lang zh-cn` installation and that the selection survives a later plain install. Installing with `--lang zh-cn` produced a Simplified Chinese interface in the requesting session and recorded `language: "zh-cn"` in the installed `locale.json`.

The installed extension was exercised through the manual live-pane path. With OmO running inside a real Herdr pane, `/dag-pane` created the viewer as a sibling pane at the requested ratio and showed the connected indicator. The empty state, task list, dependency labels, and key hints rendered in Simplified Chinese with correct double-width alignment. A real background subtask dispatched from that same session appeared in the viewer as a live task card carrying its status, category, agent/model, and elapsed time, and the card updated while the task ran. Exiting the OmO session left the viewer showing the localized disconnected notice and snapshot; `q` closed the pane and the source pane kept focus throughout.

The viewer requires Node 24 or later. On this host the pane shell's `node` was 23.11.0, so `OMO_HERDR_DAG_NODE` had to point at a 24 binary; without it the extension's existing guard reports the requirement in the selected language and does not open a pane.

The scripted checks in `scripts/verify-native.mjs` could not be used on this host. Both paths fail against OmO 5.0.1 / Senpi 2026.9.27 **identically on untouched `v1.4.0`**: the non-live path at line 59, before any state file exists, and the live path at line 79 with zero pane records — while the same installed extension works through the real OmO path described above. As this document notes, those source assertions are bound to the beta.42 bundle. Its `OMO_PACKAGE_ROOT` layout also expects `<root>/node_modules/@code-yeongyu/senpi` and `<root>/plugin` in one directory, which a hoisted npm/Bun installation does not provide; pointing it at a directory of symlinks to both real locations is what let it reach the assertions at all.

## Current limits

The earlier release baseline passed 20 behavior tests. Version 1.1.0 extends that coverage as described above. The package smoke check installs the actual tarball offline and verifies CLI execution, language selection and persistence, installer dry-run, extension imports, updates, and the MIT notice. These checks do not replace the live compatibility limits below.

The standalone `omob` launcher issue was fixed by resolving and probing a separate Node.js 24+ runtime instead of using the compiled OmO executable as an interpreter. Regression checks cover a compiled host path, normal Node hosts, explicit overrides, unsupported runtimes, and failure before pane creation. After installing the fix, the viewer rendered the reported state using `--once` with a simulated compiled-host executable path and the real Node 24.14.0 fallback. The installed Senpi loader and RPC bus checks also passed. These checks did not restart the active `omob` session or verify its compiled extension loader end to end.

- **Unmodified Herdr without custom OmO registration:** the implementation only uses ordinary pane commands and does not require agent recognition. A clean installation was exercised end to end on macOS with Herdr 0.9.1 (2026-09-29, see above).
- **Real workflow production path:** existing-workflow recovery and live task detail display were verified for 1.1.0. A fresh complete workflow and live progress from newly launched nested children remain unverified end to end.
- **Native macOS:** verified on 2026-09-29 for macOS 15.8 / arm64 through the real OmO path rather than the scripted harness (see above). Windows coverage is limited to the local PowerShell/Herdr environment described above; Windows panes using cmd.exe or Git Bash are not supported by the Windows command builder.
- **Other OmO/Senpi versions:** unverified in general. Internal event contracts may change; the current source-level verifier is specific to the inspected beta.42 bundle and does not run against OmO 5.0.1 / Senpi 2026.9.27, although the installed extension worked through the real OmO path on that combination.
- **CI:** a Linux matrix for Node 24 and 26 runs tests, builds, npm package checks, and artifact upload. Hosted CI and the release workflow's manual npm dry run have passed in the public repository; actual npm publication requires separate authentication.
- **Interface language:** English is now the default. Korean and Simplified Chinese are selectable through `install --lang ko` / `--lang zh-cn` or `OMO_HERDR_DAG_LANG=ko` / `=zh-cn`. English, Korean, and Simplified Chinese README files are provided. The earlier live-pane baseline above used the original Korean interface.

Use [CONTRIBUTING.md](CONTRIBUTING.md) to reproduce the checks. Add new compatibility evidence only after running the relevant environment, and omit private hostnames, session IDs, and local account paths from public results.
