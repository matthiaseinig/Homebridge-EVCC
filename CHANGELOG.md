# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Version bumps and entries below are managed by
[release-please](https://github.com/googleapis/release-please) on every push to
`main`.

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
