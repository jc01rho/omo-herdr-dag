# Verification and compatibility

This record separates observed behavior from integration assumptions. The baseline checks below were performed on 2026-09-05 before public release.

## Tested environments

| Environment | Observed coverage |
| --- | --- |
| Linux x86_64, Node 24.14.0 | 10 behavior tests passed; installed Senpi loader and RPC bus passed; live Herdr pane creation, rendering, updates, focus preservation, and cleanup verified. |
| Two additional Linux x86_64 hosts, Node 26.7.0 | 10 behavior tests passed on each host; source and installed extension entry points passed installed-loader and RPC bus checks. No live panes were created on those hosts. |
| OmO `5.0.0-0.beta.42`, Senpi `2026.9.4-3` | The snapshot producer, RPC projection, and shared event bus contract were inspected in the installed packages. |
| Herdr protocol 20 | Its pane CLI was exercised in an environment with custom OmO agent reporting. |

## Observed behavior

- A five-node example with five explicit edges rendered its split and merge structure in a real Herdr pane.
- The source pane retained focus. In a 162-column layout, the source pane received 105 columns and the viewer received 57 columns with `--ratio 0.65`.
- Repeated synthetic events reused the same pane. A subsequent completed snapshot updated all five nodes in that viewer, confirmed by Herdr's output matching command.
- Shutting down the test extension left the final graph visible with a disconnected indicator.
- Pressing `q` closed the generated viewer pane and restored the source pane's width. All temporary viewer panes were cleaned up.
- The copied installation loaded independently through its generated extension entry point.

The live check used the actual Senpi loader and `pi.rpc.emit()` with an explicitly labeled **synthetic DAG snapshot**. It did not execute model workers or a real workflow. Unit tests used mocked pane commands; these are not evidence of stock Herdr compatibility.

## Current limits

The current source also passes 20 behavior tests, including English-default and Korean rendering, Node runtime selection, and a real Node executable probe, plus a local npm distribution build. The package smoke check installs the actual tarball offline and verifies CLI execution, language selection and persistence, installer dry-run, extension imports, updates, and the MIT notice. These checks do not replace the live compatibility limits below.

The standalone `omob` launcher issue was fixed by resolving and probing a separate Node.js 24+ runtime instead of using the compiled OmO executable as an interpreter. Regression checks cover a compiled host path, normal Node hosts, explicit overrides, unsupported runtimes, and failure before pane creation. After installing the fix, the viewer rendered the reported state using `--once` with a simulated compiled-host executable path and the real Node 24.14.0 fallback. The installed Senpi loader and RPC bus checks also passed. These checks did not restart the active `omob` session or verify its compiled extension loader end to end.

- **Unmodified Herdr without custom OmO registration:** the implementation only uses ordinary pane commands and does not require agent recognition. A clean installation has not yet been tested end to end.
- **Real workflow production path:** the OmO event producer was inspected, and synthetic events were verified through the native bus. A complete real-workflow smoke test remains to be recorded.
- **Native macOS and Windows:** unverified. All observed execution environments above were Linux.
- **Other OmO/Senpi versions:** unverified. Internal event contracts may change; the current source-level verifier is specific to the inspected beta.42 bundle.
- **CI:** a Linux matrix for Node 24 and 26 runs tests, builds, npm package checks, and artifact upload. Hosted CI and the release workflow's manual npm dry run have passed in the public repository; actual npm publication requires separate authentication.
- **Interface language:** English is now the default. Korean is selectable through `install --lang ko` or `OMO_HERDR_DAG_LANG=ko`. Both English and Korean README files are provided. The earlier live-pane baseline above used the original Korean interface.

Use [CONTRIBUTING.md](CONTRIBUTING.md) to reproduce the checks. Add new compatibility evidence only after running the relevant environment, and omit private hostnames, session IDs, and local account paths from public results.
