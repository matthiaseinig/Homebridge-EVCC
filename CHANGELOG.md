# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Version bumps and entries below are managed by
[release-please](https://github.com/googleapis/release-please) on every push to
`main`.

## [0.2.0](https://github.com/matthiaseinig/Homebridge-EVCC/compare/v0.1.0...v0.2.0) (2026-05-04)


### Features

* initial release of homebridge-evcc ([ef8dd8d](https://github.com/matthiaseinig/Homebridge-EVCC/commit/ef8dd8dc17e5f15b18e69cb16f207f5574e12532))


### Bug Fixes

* **install:** ship pre-built dist and drop prepare hook ([c333226](https://github.com/matthiaseinig/Homebridge-EVCC/commit/c333226a9cced8d1bd0533d620103653adaeef33))
* **loader:** emit CommonJS so Homebridge can require() the plugin ([8089ab5](https://github.com/matthiaseinig/Homebridge-EVCC/commit/8089ab5337afc50c37cd56be27c42c645adbb91b))

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
