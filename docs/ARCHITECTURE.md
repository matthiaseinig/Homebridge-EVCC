# Architecture

## Overview

```
┌────────────────────┐  HTTP /api/state  ┌───────────────────┐    HAP   ┌──────────┐
│   Homebridge-EVCC  │ ◀───────────────  │  EVCC HTTP server │          │  iOS     │
│  (this plugin)     │                   │  (evcc binary)    │          │  Home    │
│                    │  WSS /ws diffs    │                   │ ◀──────▶ │  app     │
│                    │ ◀───────────────  │                   │          │          │
│                    │  POST commands    │                   │          │          │
│                    │ ───────────────▶  │                   │          │          │
└────────────────────┘                   └───────────────────┘          └──────────┘
```

The plugin is a pure client of an existing EVCC instance — it does not spawn or configure EVCC. The user is expected to run EVCC themselves and point the plugin at it.

## Data flow

### Read path

1. **Initial fetch** — `GET /api/state` returns the complete state snapshot (the same payload the EVCC web UI loads on first paint). This populates the in-memory `state` cache and triggers initial accessory adoption.
2. **Real-time diffs** — the plugin opens a websocket to `/ws`. EVCC sends one JSON frame per state change, with dotted-path keys, e.g.:
   ```json
   {"pvPower": 4500}
   {"loadpoints.0.chargePower": 1234}
   {"loadpoints.1": {"title": "Garage", "chargePower": 7000, "...": "..."}}
   ```
   The plugin merges each frame into the in-memory cache and re-renders the affected accessories.
3. **REST polling** — every `pollInterval` seconds (default 30s) the plugin re-fetches `/api/state` as a safety net for missed websocket frames or websocket drops.

### Write path

1. The user toggles a HomeKit characteristic (charge limit, mode, battery mode).
2. The accessory's `onSet` handler delegates to the `EvccClient`, which:
   - Re-authenticates if the cookie has expired.
   - Issues `POST /api/loadpoints/{id}/...`, `POST /api/vehicles/{name}/...`, or `POST /api/batterymode/{mode}`.
3. EVCC applies the change; the next websocket frame from EVCC echoes the new state, which closes the loop.

## Authentication

EVCC's read endpoints (state, log areas, etc.) are open. Write endpoints require the admin cookie obtained from `POST /api/auth/login`. The plugin:

- Logs in on startup if a `password` is configured. On 401 it logs a warning and drops back to read-only mode (settable controls become inert).
- Reuses the cookie for an hour, then refreshes lazily on the next request.
- Flushes the cookie on a 401 from any endpoint, so the next call attempts a fresh login.

## Module layout

| Module | Responsibility |
|---|---|
| [`src/index.ts`](../src/index.ts) | `api.registerPlatform` entry point. |
| [`src/settings.ts`](../src/settings.ts) | `PLATFORM_NAME`, `PLUGIN_NAME` constants. |
| [`src/platform.ts`](../src/platform.ts) | DynamicPlatformPlugin — owns the EvccClient, fans state/update events out to the accessory wrappers, prunes stale ones. |
| [`src/api/client.ts`](../src/api/client.ts) | REST + WebSocket transport, auth, polling, reconnect backoff. |
| [`src/api/types.ts`](../src/api/types.ts) | TypeScript types for State, Loadpoint, Vehicle, BatteryMode, etc. Loose by design — EVCC's state surface is documented as "may change between releases". |
| [`src/api/decoders.ts`](../src/api/decoders.ts) | `parseFrame` (JSON guard), `applyUpdate` (dotted-path merge), `splitPath`, `asLoadpointArray`. |
| [`src/accessories/loadpointAccessory.ts`](../src/accessories/loadpointAccessory.ts) | Per-loadpoint accessory: outlet, charge-limit blinds, optional vehicle-limit blinds, vehicle battery, charge-power LightSensor, optional mode switches. |
| [`src/accessories/siteAccessory.ts`](../src/accessories/siteAccessory.ts) | Site-level accessory: home battery, PV, grid power + direction, home consumption, optional battery-mode switches. |
| [`src/accessories/vehiclePresenceAccessory.ts`](../src/accessories/vehiclePresenceAccessory.ts) | Per-vehicle OccupancySensor — fires while the vehicle is connected at any loadpoint. |
| [`src/util/redact.ts`](../src/util/redact.ts) | Password redaction for log output. |
| [`src/util/powerToLux.ts`](../src/util/powerToLux.ts) | Maps watts onto HomeKit's `CurrentAmbientLightLevel` characteristic, plus `clampPercent` for SOC values. |

## Why `WindowCovering` for the charge limit?

HomeKit only exposes a few native services that include a settable 0–100 % slider: `WindowCovering` (TargetPosition / CurrentPosition), `Lightbulb` (Brightness), `Fan` (RotationSpeed), and `Thermostat` (target temp, but constrained to °C/°F). `WindowCovering` is the cleanest visual match — the Home app draws a vertical slider with both target and current position, which maps perfectly onto "drag to set limitSoc; the bar fills as the car charges towards it".

## Why `LightSensor` for power values?

HomeKit doesn't ship a generic numeric-display service. `LightSensor`'s `CurrentAmbientLightLevel` is the most widely-used "any number" mapping in the Homebridge ecosystem (Eve, the various PV plugins, energy-monitor plugins). It is a `float` with a 0.0001…100000 range, displays as a graph in Eve, and Home shows the current value on the tile. Watts → lux 1:1, clamped at the ceiling.

## Coverage targets

`vitest.config.ts` enforces 95 % statements/lines/functions and 90 % branches. The branch threshold is intentionally lower because the EVCC state surface has a lot of optional fields and our accessories defensively fall through nullish branches that don't all surface in unit tests.
