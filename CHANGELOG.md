# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Version bumps and entries below are managed by
[release-please](https://github.com/googleapis/release-please) on every push to
`main`.

## [1.2.1] - 2026-11-11

### Fixed
- `Charge Mode` (E5C00041) now passes through and accepts writes for every mode
  EVCC 0.319 uses: `off`, `now`, `smart`, `minpv` and `pv` (source:
  `api/chargemodestatus.go` in evcc-io/evcc; `minpv` and `pv` are deprecated
  upstream and normalized to `smart`). Previously `smart` was rejected on write.
  The characteristic is a free-form string, which HomeKit cannot constrain with
  a valid-values list, so validation stays in the write handler.
- Security: the debug log line "EVCC login" no longer prints the first and last
  characters of the EVCC password; it logs only `configured` or `not configured`.
  URLs written to the log (startup line, login, websocket) have any embedded
  `user:password@` credentials removed. `redactSecret` was replaced by
  `describeSecret` and `redactUrl`.

## [1.0.1] - 2026-05-05

### Added
- README install section now documents the proven hb-service install flow:
  pin via `npm install --save matthiaseinig/Homebridge-EVCC#vX.Y.Z` inside
  `/var/lib/homebridge/` so container restarts re-install the same version
  automatically. Also covers the standalone Homebridge install and the
  future-npm install for completeness.

### Fixed
- AccessoryInformation `Name` characteristic now refreshes when EVCC pushes a
  new `title` / `siteTitle` / vehicle title via WebSocket. Previously the
  accessory tile in the Home app kept its initial label even after the loadpoint
  or site was renamed in EVCC.

## [1.0.0] - 2026-05-04

### Added
- Service-name pinning via `applyServiceName` helper: each service now sets
  `displayName`, the `Name` characteristic, and (where supported) the
  `ConfiguredName` characteristic with a no-op `onSet` handler that swallows
  iOS's pairing-dialog overwrites. This stops the Home app from renaming
  sensors back to generic labels like "Sensor", "Switch", or "Outlet" after
  pairing, so the descriptive labels (e.g. "Garage Charge Limit", "PV
  Production") survive across re-pairings.

### Changed
- Switched plugin loader output to CommonJS (`module: CommonJS`,
  `moduleResolution: Node`, `export =`) so that Homebridge's `require()`-based
  plugin scanner can load the package on hb-service installs.
- Dropped the `prepare: tsc` install hook and started shipping pre-built
  `dist/` in the repository, so `npm install -g <git-url>` works on Homebridge
  hosts that don't expose `tsc` on PATH during npm's nested install step.

## [0.1.0] - 2026-05-04

### Added
- Initial public release.
- REST + WebSocket client for EVCC (`/api/state`, `/ws`).
- Optional admin authentication via `POST /api/auth/login`; read-only mode when
  no password is configured.
- Site accessory: home battery (`Battery`), PV / grid / home power
  (`LightSensor` triplet), grid direction (`ContactSensor`), optional battery
  mode switches.
- Loadpoint accessory: enable/connect outlet, `WindowCovering` charge-limit
  slider (per loadpoint, optionally also per vehicle), `Battery` for the
  assigned vehicle's SOC, `LightSensor` for charge power, optional mode switches.
- Per-vehicle `OccupancySensor` ("car is plugged in").
- 91 unit tests, ≥95% statement coverage / ≥90% branch coverage.
- CI matrix (Node 20/22/24) and `release-please` automation for version bumps,
  changelog, and npm publishing.
