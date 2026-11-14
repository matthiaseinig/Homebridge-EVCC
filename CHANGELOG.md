# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Version bumps and entries below are managed by
[release-please](https://github.com/googleapis/release-please) on every push to
`main`.

## [1.3.1] - 2026-11-14

### Added
- `GET /v1/hello?nonce=<43 characters base64url, no padding>` on the sessions API: a proof route that needs no `Authorization` header, so the app can verify it reached the real home service before it sends its bearer token (for example over a VPN tunnel). Same peer and exact `Host` checks as the other routes. Answers 204 with `X-Home-Proof: base64url(HMAC-SHA256(key = API token, msg = "HOME-HELLO\n" + nonce + "\n" + <bindAddress>:<port>))` and `Cache-Control: no-store`; a bad nonce is 400, more than 30 requests per minute per peer is 429. Every other route still needs the token. The token and the proof are never logged.
- The route is served only when the API token is at least 32 characters of hex or base64 characters, has at least 10 distinct characters and no run of more than 4 equal characters (generated tokens always qualify). Otherwise it answers 404 and one warning at start recommends deleting the API token file and restarting.

## [1.3.0] - 2026-11-11

### Added
- `Always Charge` (E5C00052, bool, read and write) on `Loadpoint Energy`:
  EVCC 0.319 replaced the `pv` and `minpv` modes with `smart` plus an "always
  charge" setting (charge without interruptions, at least at the minimum
  current). Read: `alwaysCharge` is `on` or `once`; write: `POST
  /api/loadpoints/{id}/alwayscharge/{on|off}` (source: `api/chargemode.go`,
  `api/chargemodestatus.go` and `server/http.go` in evcc-io/evcc 0.319.0).
  Refused with `NOT_ALLOWED_IN_CURRENT_STATE` on older EVCC and on
  switch-socket chargers, which EVCC does not allow always charge for.
- `Min Current` (E5C00053, float, A, read only): `effectiveMinCurrent`, so apps
  can label the setting ("always charge, min 7 A").

### Changed
- `Charge Mode` writes of the deprecated `pv` and `minpv` are mapped on EVCC
  0.319: `pv` sets always charge off and the mode to `smart`, `minpv` sets
  always charge on and the mode to `smart`. Older EVCC gets them unchanged.
  The outlet's default mode (`pv`) goes through the same mapping.
- The legacy mode switches (`loadpointMode: "switches"`) show `smart` as Min+PV
  while always charge is active and as PV otherwise, so they work on EVCC 0.319.

## [1.2.2] - 2026-11-11

### Fixed
- Security: error texts written to the log (login failed, poll failed, failed to
  reach EVCC, websocket errors, write failures, sessions errors) could contain
  the full request URL including `user:password@` when the configured URL has
  credentials. Every logged error text now goes through `errorText`, which
  strips URL credentials and replaces the configured password. The sessions
  `lastError` shown by the LAN API is redacted the same way.

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

## [1.2.0] - 2026-11-10

### Fixed
- An Apple Home scene or a Siri request such as "close all blinds" could change
  the car's charge limit, because the limit was a `WindowCovering` and HomeKit
  writes are on. The limit window coverings (`limit-loadpoint`, and
  `limit-vehicle` with `exposeVehicleLimit`) are now off by default and are
  removed from accessories restored from the Homebridge cache.

### Added
- `Charge Limit` characteristic (`E5C00051-...`) on the `Loadpoint Energy`
  service: reads `limitSoc`, accepts an integer 0 to 100 (0 clears the session
  limit) and forwards it to `POST /api/loadpoints/{id}/limitsoc/{value}`. The
  Apple Home app ignores it, so no Home app scene can reach it.
- `limitWindowCovering` option (default `false`) that brings the old blinds
  slider back for users who accept the scene risk. `exposeVehicleLimit` now
  needs it and logs a warning without it.

### Migration
- Not a re-pair. The charge-limit tile disappears from the Home app; scenes
  and automations that contained it lose that one action. Check "close all
  blinds" style scenes once after the update. Apps switch to `Charge Limit`
  (docs/app-contract.md).

## [1.1.0] - 2026-11-10

### Added
- Charging history: the plugin polls EVCC's session log (`GET /api/sessions`,
  read only) every 10 minutes and once after a loadpoint stops charging or is
  unplugged, and stores a bounded copy in the Homebridge storage folder
  (`evcc-sessions.json`, 0600, atomic writes).
- `Charging History` HomeKit service on each loadpoint (`E5C10006-...`) with
  charged kWh today and this month, solar share this month, and the last
  session's kWh and end time (characteristics `E5C00080` to `E5C00085`).
- Optional read-only LAN API for the session log (`/v1/status`,
  `/v1/sessions`, `/v1/sessions/summary`), off by default, private bind
  address, Host check, mandatory bearer token (generated into the storage
  folder when not configured). Default port 8768.
- `sessions` config block (`enabled`, `maxSessions`, `api`).

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
