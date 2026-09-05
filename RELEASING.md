# Releases and npm distribution

The repository produces a dependency-free npm package named `omo-herdr-dag`. The package is configured for public publication, but has not been published as part of this setup. A registry lookup on 2026-09-05 returned no public package under that name; this does not reserve the name or guarantee publishing permission.

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

Actions artifacts are downloadable from the workflow run. The workflow does not publish to npm and requires no npm credentials. It starts running after the project is pushed to a GitHub repository with Actions enabled.

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

## Publish explicitly

An npm account with publishing rights to the chosen package name is required. Log in using npm's own authentication flow and comply with the account's authentication requirements. Do not store credentials in this repository.

From the reviewed source checkout:

```bash
npm login
npm publish --access public
```

The `prepublishOnly` hook runs the tests, build, and package smoke test before publication. Publishing a package version makes it available to users; review the version and package contents first. Existing versions cannot be overwritten with a new build under the same version number.

After successful publication, users can run:

```bash
npx omo-herdr-dag@latest install
npx omo-herdr-dag@latest install --lang ko
```

Remove the initial-unpublished notice from both READMEs when the first package release is available. GitHub hosts the source; npm serves package downloads; the extension and TUI run locally inside the user's OmO/Herdr environment. No hosted application service is needed.
