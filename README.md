<p align="center">
  <img src="https://raw.githubusercontent.com/matthiaseinig/Homebridge-EVCC/main/assets/icon.jpeg" alt="EVCC" width="160" />
</p>

# Homebridge-EVCC

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-evcc"><img src="https://img.shields.io/npm/v/homebridge-evcc?logo=npm&label=npm" alt="npm version" /></a>
  <a href="https://github.com/matthiaseinig/Homebridge-EVCC/actions/workflows/ci.yml"><img src="https://github.com/matthiaseinig/Homebridge-EVCC/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/matthiaseinig/Homebridge-EVCC/blob/main/LICENSE"><img src="https://img.shields.io/github/license/matthiaseinig/Homebridge-EVCC" alt="MIT License" /></a>
  <a href="https://homebridge.io"><img src="https://img.shields.io/badge/homebridge-1.8%20%7C%202.0--beta-blue" alt="Homebridge 1.8 / 2.0-beta" /></a>
</p>

Homebridge plugin for [EVCC](https://evcc.io) — the open-source solar charging controller for electric vehicles.

It exposes everything EVCC knows about your home as native HomeKit accessories: a charge-limit slider you can drag in the Home app, your car's battery level, your home battery state, your PV production, your grid import/export, and a per-vehicle "is plugged in" sensor that powers automations like "garage light when my car arrives".

## Features

- **Charge-limit slider** per loadpoint, modeled as a `WindowCovering` so you get a clean 0–100 % slider in the Home app — drag to set the loadpoint's `limitSoc` directly. Optionally a second slider that drives the assigned vehicle's `limitSoc` instead.
- **Vehicle SOC + range** as a `BatteryService` per loadpoint, with `ChargingState` and low-battery flag.
- **Loadpoint outlet** — `On` reflects whether the loadpoint is enabled, `OutletInUse` reflects whether a vehicle is connected. Toggling it sets the configured charge mode (default `pv`).
- **Per-vehicle presence sensor** — a HomeKit `OccupancySensor` per known vehicle, fires while the vehicle is connected at any loadpoint.
- **Site telemetry accessory** — home-battery SOC, PV production, grid import/export, and home consumption, all as `LightSensor` services (lux ≈ watts; the customary HomeKit "any number" mapping).
- **Optional mode switches** — flip the loadpoint UI to 3 mutually-exclusive switches (Now / PV / Min+PV) instead of the single on/off outlet.
- **Energy and charging characteristics for apps** (on by default): custom HomeKit services with site energy (PV total and per array, grid power per phase, signed, home, aux and battery power, battery SoC, meter totals, tariffs) and charging (per loadpoint charge power, mode, session and today energy, vehicle SoC and range, planned departure, plus EVCC's charging statistics). `Charge Mode` and `Set Plan` accept writes, so apps can switch the mode and set or clear a departure plan; the existing controls carry read-only role tags. The Apple Home app ignores these custom services; apps that read HomeKit directly (such as the Zuhause iOS app) get exact values, units and signs. Everything is documented in [docs/zuhause-contract.md](docs/zuhause-contract.md).
- **Charging history** (on by default): the plugin polls EVCC's own session log (`GET /api/sessions`) every 10 minutes, and once shortly after a loadpoint stops charging or is unplugged, and keeps a bounded copy in the Homebridge storage folder. A `Charging History` service on each loadpoint shows charged kWh today and this month, the solar share this month and the last session (kWh and end time). An optional read-only LAN API (off by default) serves the full session list and monthly or yearly totals. See [Charging history](#charging-history).
- **Write errors are reported.** When EVCC rejects a write or cannot be reached, the plugin returns a HomeKit error, so the Home app shows "No Response" on the tile instead of pretending the change worked.
- **Optional battery-mode switches** — Normal / Hold / Charge for your home battery, when an admin password is configured.

## Install

The plugin ships a pre-built `dist/` in the repo and on the GitHub release tarballs, so no TypeScript compilation runs on the install host.

### Homebridge UI / hb-service (recommended)

The Homebridge image / `hb-service` installs read plugins from `/var/lib/homebridge/node_modules/`. The clean way to add plugins is to pin them in `/var/lib/homebridge/package.json` so container restarts re-install the same version automatically:

```sh
cd /var/lib/homebridge
/opt/homebridge/bin/npm install --save matthiaseinig/Homebridge-EVCC#v1.0.1
```

That adds an entry like `"homebridge-evcc": "github:matthiaseinig/Homebridge-EVCC#v1.0.1"` to `package.json` and installs the package into `/var/lib/homebridge/node_modules/`. To upgrade later, bump the tag and re-run the same command.

If you prefer `hb-service` UI flows, you can also paste `matthiaseinig/Homebridge-EVCC` into the Homebridge UI's "Install Plugin" dialog (Plugins tab → search box accepts GitHub `user/repo` shorthand).

### Standalone Homebridge (no hb-service)

```sh
sudo npm install -g matthiaseinig/Homebridge-EVCC
```

### Once published to npm

```sh
sudo npm install -g homebridge-evcc
```

(Or install from the Homebridge UI's plugins tab in the usual way.)

## Quick start

1. Install the plugin (see above).
2. Open the plugin settings in the Homebridge UI and enter your EVCC base URL, e.g. `http://evcc.local:7070`.
3. (Optional) Enter the EVCC admin password — required only if you want to drive controls (charge limit, mode, battery mode) from HomeKit. Without it the plugin runs read-only.
4. Save and restart Homebridge.

## Configuration

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | yes | Must be `EVCC` |
| `name` | string | yes | Display name in Homebridge logs |
| `url` | string | yes | Base URL of your EVCC instance, no trailing slash |
| `password` | string | no | Admin password. Without it, all settable controls are inert. |
| `pollInterval` | integer | no | REST poll cadence in seconds. Default `30`. The websocket pushes diffs in real time; the poll is a safety net. |
| `loadpointMode` | enum | no | `outlet` (default), `switches`, or `readonly` |
| `defaultLoadpointMode` | enum | no | When `loadpointMode = outlet`: which mode the outlet activates when toggled ON. `now`, `pv` (default), or `minpv`. |
| `exposeVehicleLimit` | boolean | no | Add a second WindowCovering per loadpoint that drives the assigned vehicle's `limitSoc`. Default `false`. |
| `hideSite` | boolean | no | Suppress the site-wide telemetry accessory. Default `false`. |
| `hideVehiclePresence` | boolean | no | Suppress per-vehicle presence sensors. Default `false`. |
| `hideEnergyCharacteristics` | boolean | no | Suppress the custom energy and charging services and the control tags (see [docs/zuhause-contract.md](docs/zuhause-contract.md)). Default `false`. |
| `sessions` | object | no | Charging history, see [Charging history](#charging-history). |
| `debug` | boolean | no | Verbose logging of WS frames and REST traffic. |

Example `config.json` block:

```json
{
  "platforms": [
    {
      "platform": "EVCC",
      "name": "EVCC",
      "url": "http://evcc.local:7070",
      "password": "your-admin-password",
      "loadpointMode": "outlet",
      "defaultLoadpointMode": "pv",
      "exposeVehicleLimit": true
    }
  ]
}
```

## Charging history

The plugin reads EVCC's session log (`GET /api/sessions`, read only; it never writes to EVCC), keeps a copy in the Homebridge storage folder (`evcc-sessions.json`, mode 0600, at most `maxSessions` sessions) and shows summaries per loadpoint through the custom `Charging History` service (`E5C10006-8B93-4652-90CD-F02EAF5356EA`, characteristics `E5C00080` to `E5C00085`, see [docs/zuhause-contract.md](docs/zuhause-contract.md)).

| `sessions` field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Poll and keep the session log and show the `Charging History` service. |
| `maxSessions` | integer | `5000` | Oldest sessions are dropped beyond this many (100 to 50000). |
| `api.enabled` | boolean | `false` | Serve the read-only LAN API. |
| `api.bindAddress` | string | none | Literal private or loopback IP address to bind (for example the Homebridge host's LAN address). Required for the API; `0.0.0.0` and host names are rejected. |
| `api.port` | integer | `8768` | Port of the API. |
| `api.token` | string | generated | Bearer token (at least 16 characters). When empty, a token is generated once into `evcc-sessions-token` in the storage folder (mode 0600). |

The API answers `GET /v1/status`, `GET /v1/sessions?from&to&limit&cursor` and `GET /v1/sessions/summary?period=month|year`, only for private peers, only with `Host: <bindAddress>:<port>` and `Authorization: Bearer <token>`. Details are in the [contract](docs/zuhause-contract.md#sessions-lan-api).

```json
"sessions": {
  "enabled": true,
  "api": { "enabled": true, "bindAddress": "192.168.1.10", "port": 8768 }
}
```

## Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/matthiaseinig/Homebridge-EVCC/main/docs/screenshots/home-app.png" alt="EVCC accessories in the iOS Home app" width="320" />
</p>

## Triggering automations

Every binary signal the plugin exposes can drive a HomeKit automation. Useful patterns:

- **"Car arrives home"** — trigger on the per-vehicle Occupancy sensor going Triggered. Lights on, doors unlocked, scene set.
- **"Charging started"** — trigger on a loadpoint outlet's Power lux jumping above a threshold (or on the assigned vehicle's BatteryService ChargingState).
- **"Low car battery"** — trigger on `StatusLowBattery` of the loadpoint's vehicle Battery service for an away-from-home alert.
- **"Solar surplus"** — trigger on PV Production lux exceeding home consumption lux to start the dishwasher.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, the websocket diff protocol, and the per-accessory service map. The full HomeKit service inventory is in [docs/ACCESSORIES.md](docs/ACCESSORIES.md). The custom energy and charging characteristics and the control semantics (UUIDs, units, ranges, signs, EVCC source fields, write effects, error codes) are specified in [docs/zuhause-contract.md](docs/zuhause-contract.md).

## Development

```sh
git clone https://github.com/matthiaseinig/Homebridge-EVCC.git
cd Homebridge-EVCC
npm install
npm run build         # tsc → dist/
npm test              # vitest run
npm run test:coverage # 95% line / 90% branch threshold
npm run lint
npm run dev           # builds and starts a local Homebridge instance from ./dev/
```

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Conventional Commits are required so `release-please` can compute the next version automatically.

## License

[MIT](LICENSE) © Matthias Einig.
