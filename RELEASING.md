# Releases and npm distribution

The repository produces the dependency-free [omo-herdr-dag npm package](https://www.npmjs.com/package/omo-herdr-dag). Version 1.0.0 was published on 2026-09-05 from the verified GitHub Release tarball after interactive npm authentication. The registry tarball matches the GitHub asset (SHA1 `b88d275f5e3b90d3941cfdaba151ad9906027c0c`). Configure trusted publishing below before relying on unattended subsequent releases.

## What ships

- `bin/omo-herdr-dag.mjs`: the `omo-herdr-dag install` CLI, usable through `npx` or a global npm installation.
- `dist/`: the extension, TUI, installer, and MIT license, assembled by `npm run build`.
- Package metadata, license, and documentation.

Source tests, development scripts, GitHub configuration, and runtime state are excluded by the npm `files` allowlist. The package has no dependency install hooks. The explicit CLI command installs the extension; it defaults to English on a new installation and supports `--lang ko`.

## GitHub Actions

The **Test and build** workflow runs on pushes, pull requests, and manual dispatch. For Node 24 and 26 on Linux, it performs:

1. `npm ci --ignore-scripts --no-audit --no-fund`
2. `npm test`
3. `npm run build`
4. `npm run test:package`
5. `npm pack`, followed by upload of the `.tgz` artifact.

Actions artifacts are downloadable from the workflow run. This verification workflow requires no npm credentials and is also reused by **Release to GitHub and npm** (`.github/workflows/publish.yml`).

The publish workflow runs on pushed `v*` tags. It waits for both Node versions to pass, checks that the tag, package version, and lockfile versions match, and publishes the Node 24 tarball from that same run with provenance. Stable versions use `latest`; versions containing a prerelease suffix use `next`. Concurrent releases of the same ref are serialized. An existing npm version cannot be overwritten.

After verification, separate jobs create a [GitHub Release](https://github.com/jc01rho/omo-herdr-dag/releases) and publish to npm. The GitHub release includes generated notes and the same Node 24 `.tgz` as a downloadable asset; prerelease versions are marked as prereleases. It uses the built-in `GITHUB_TOKEN` with `contents: write` and can succeed even if npm authentication fails. Reruns preserve an existing GitHub release. A GitHub release alone does not confirm npm availability.

Manual dispatch runs verification and `npm publish --dry-run` only, even when a tag is selected. It never publishes to npm or creates a GitHub release and needs no npm authentication.

## Prepare a version

Set the intended version in `package.json` and `package-lock.json`, keep both READMEs current, and record actual compatibility results in `VERIFICATION.md`. The `repository`, `homepage`, and `bugs` metadata point to [jc01rho/omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag); keep them current if the repository moves.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --dry-run
```

`npm pack` runs the `prepack` build hook. To retain a local artifact:

```bash
mkdir -p .artifacts
npm pack --pack-destination .artifacts
```

The package smoke test checks an actual tarball in a temporary project, using offline npm installation. It checks the executable, English default, Korean selection, dry-run behavior, installed extension imports, MIT notice, and update preservation.

## Configure npm authentication once

An npm account with publishing rights to `omo-herdr-dag` is required. GitHub's `GITHUB_TOKEN` cannot publish to the public npm registry. The publish job uses the GitHub environment named **`NPM_TOKEN`**, which contains the secret also named **`NPM_TOKEN`**. The environment name and secret name are separate settings.

For token-based publication through Actions, create an npm granular access token with package write access that permits creating this package and with **Bypass 2FA** enabled for unattended publishing. Add it as the environment secret **`NPM_TOKEN`** under the **`NPM_TOKEN`** environment in [GitHub environment settings](https://github.com/jc01rho/omo-herdr-dag/settings/environments). A repository Actions secret with that name also works if the environment has no overriding secret. Enter it directly in GitHub; never commit it or paste it into an issue. The workflow exposes this secret only to the publish step. Account policies and token expiration still apply. Environment protection rules, if added, also apply to manual dry runs.

After the package exists, prefer npm trusted publishing to remove the long-lived token. In the npm package settings, add a GitHub Actions trusted publisher with:

| Field | Value |
| --- | --- |
| Organization or user | `jc01rho` |
| Repository | `omo-herdr-dag` |
| Workflow filename | `publish.yml` |
| Environment | `NPM_TOKEN` |
| Allowed actions | Enable **`npm publish`** for direct automatic publication. `npm stage publish` alone is insufficient. |

Then remove the `NPM_TOKEN` environment secret and any repository secret with that name. The workflow already grants `id-token: write`, uses a GitHub-hosted Ubuntu runner, and uses Node 24 with a current npm version supporting trusted publishing (npm 11.5.1 or newer). npm can authenticate through OIDC without a stored token. Trusted publishing must be configured on npm; granting the GitHub permission alone is insufficient. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Publish a version

Commit and push the intended source and matching package/lockfile versions. For a new version (replace `1.0.1` with the intended version):

```bash
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

For subsequent versions, use `npm version patch` (or `minor` / `major`) on a clean checkout, then push the resulting commit and version tag. A prerelease such as `1.1.0-beta.1` requires tag `v1.1.0-beta.1` and publishes under `next`.

The workflow publishes the already built and verified tarball with lifecycle scripts disabled; the reusable verification job has already run the tests, build, and package smoke test. Local `npm publish --access public` remains possible after `npm login`; its `prepublishOnly` hook performs those checks itself.

Watch the **Release to GitHub and npm** run in [Actions](https://github.com/jc01rho/omo-herdr-dag/actions/workflows/publish.yml). If authentication fails before publication, configure it and rerun the failed job. If a version was already published, bump the version for new contents rather than moving the old release tag. A successful dry run verifies packaging, not npm write permission.

### If npm requests additional authentication (`EOTP`)

An `EOTP` response means npm requires an interactive authentication step; storing a token in GitHub does not guarantee unattended publishing permission. Check the token's package write scope and **Bypass 2FA** setting, and the account/package publishing policy. Replace the environment secret if necessary and rerun the failed publish job. Never store a one-time code as a permanent Actions secret.

If the first package publication requires interactive authentication, publish the verified GitHub Release asset from a terminal after `npm login`, completing npm's browser/2FA prompt:

```bash
gh release download v1.0.0 --repo jc01rho/omo-herdr-dag --pattern 'omo-herdr-dag-1.0.0.tgz' --dir .artifacts
npm login
npm publish .artifacts/omo-herdr-dag-1.0.0.tgz --ignore-scripts --access public
```

Then configure trusted publishing for subsequent releases using the fields above. npm configurations created after September 3, 2026 default to allowing staged publication, so explicitly enable `npm publish` for this workflow. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) and [the token-policy notice](https://gh.io/npm-gat-bypass2fa-deprecation) for current requirements.

After successful publication, users can run:

```bash
npx omo-herdr-dag@latest install
npx omo-herdr-dag@latest install --lang ko
```

GitHub hosts the source; npm serves package downloads; the extension and TUI run locally inside the user's OmO/Herdr environment. No hosted application service is needed.
