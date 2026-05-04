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
- **Optional battery-mode switches** — Normal / Hold / Charge for your home battery, when an admin password is configured.

## Quick start

1. Install the plugin. The plugin is not yet on npm — install it directly from GitHub instead:
   ```sh
   sudo npm install -g matthiaseinig/Homebridge-EVCC
   ```
   Once the first npm release lands, `sudo npm install -g homebridge-evcc` (or installing from the Homebridge UI) will work too.
2. Open the plugin settings in the Homebridge UI and enter your EVCC base URL, e.g. `http://evcc.local:7070`.
3. (Optional) Enter the EVCC admin password — required only if you want to drive controls (charge limit, mode, battery mode) from HomeKit. Without it the plugin runs read-only.
4. Save and restart Homebridge.

> The Git-based install builds the TypeScript sources locally via the package's `prepare` hook; you'll need the same Node version Homebridge runs on.

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

## Triggering automations

Every binary signal the plugin exposes can drive a HomeKit automation. Useful patterns:

- **"Car arrives home"** — trigger on the per-vehicle Occupancy sensor going Triggered. Lights on, doors unlocked, scene set.
- **"Charging started"** — trigger on a loadpoint outlet's Power lux jumping above a threshold (or on the assigned vehicle's BatteryService ChargingState).
- **"Low car battery"** — trigger on `StatusLowBattery` of the loadpoint's vehicle Battery service for an away-from-home alert.
- **"Solar surplus"** — trigger on PV Production lux exceeding home consumption lux to start the dishwasher.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, the websocket diff protocol, and the per-accessory service map. The full HomeKit service inventory is in [docs/ACCESSORIES.md](docs/ACCESSORIES.md).

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
