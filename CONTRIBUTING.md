# Contributing

Thanks for your interest!

## Workflow

1. Fork and clone the repo.
2. `npm install`.
3. Make your changes on a feature branch off `main`.
4. Run the preflight before opening a PR:
   ```sh
   npm run preflight
   ```
   This runs lint, build, the test suite with coverage, and a production-only `npm audit`. CI runs the same on Node 20, 22, and 24.

## Conventional Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/). The repo uses [release-please](https://github.com/googleapis/release-please) which derives the next version, the changelog, and the GitHub Release directly from the commit log.

| Prefix | Bump | Example |
|---|---|---|
| `fix:` | patch | `fix: clamp negative pvPower in powerToLux` |
| `feat:` | minor | `feat: expose battery-mode switches on the site accessory` |
| `feat!:` or `BREAKING CHANGE:` footer | major | `feat!: rename loadpointMode value "off" to "readonly"` |
| `chore:` / `docs:` / `test:` / `refactor:` / `ci:` | none | `docs: add architecture diagram` |

## Coverage

The vitest config enforces a 95% statement / line / function threshold and 90% branches. Submitting a change that drops coverage below the floor will fail CI — add tests, or motivate the dip in the PR description.

## Filing issues

Please include:

- EVCC version (visible at the bottom of the EVCC web UI).
- Homebridge version, Node version, plugin version.
- Your `config.json` block (with the password redacted).
- Whether the issue reproduces with `debug: true`; if yes, attach a sanitized log excerpt.
