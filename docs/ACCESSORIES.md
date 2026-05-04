# Accessory inventory

This document is the canonical mapping between EVCC state and HomeKit services. Every entry is the data-flow you can rely on for automations.

## Site accessory (one per EVCC instance)

Display name: `siteTitle` from EVCC, falls back to `"EVCC"`.

| Service | Subtype | Characteristic ← EVCC source |
|---|---|---|
| `AccessoryInformation` | – | `Manufacturer = EVCC`, `Model = Site`, `SerialNumber = evcc-site` |
| `Battery` | `home-battery` | `BatteryLevel ← battery.soc`<br>`ChargingState ← battery.power < 0` (charging) `else` not charging<br>`StatusLowBattery ← battery.soc < 20` |
| `LightSensor` | `pv-power` | `CurrentAmbientLightLevel ← pvPower` (W → lux) |
| `LightSensor` | `grid-power` | `CurrentAmbientLightLevel ← \|grid.power\|` |
| `ContactSensor` | `grid-direction` | `ContactSensorState ← grid.power < 0` ? `CONTACT_DETECTED (export)` : `CONTACT_NOT_DETECTED (import)` |
| `LightSensor` | `home-power` | `CurrentAmbientLightLevel ← homePower` |
| `Switch` (×3) | `battery-mode-{normal,hold,charge}` | `On ← batteryMode === <mode>`. `onSet → POST /api/batterymode/<mode>`. Only present when an admin password is configured. |

Hide the entire accessory with `hideSite: true`.

## Loadpoint accessory (one per EVCC loadpoint)

Display name: `loadpoints[i].title`, falls back to `"Loadpoint <i+1>"`.

| Service | Subtype | Characteristic ← EVCC source |
|---|---|---|
| `AccessoryInformation` | – | `SerialNumber = lp-<index>` |
| `Outlet` | `outlet` | `On ← enabled`<br>`OutletInUse ← connected`<br>`onSet`: `true → POST /api/loadpoints/<id>/mode/<defaultLoadpointMode>`; `false → mode/off` |
| `WindowCovering` | `limit-loadpoint` | `TargetPosition ↔ limitSoc` (write & read)<br>`CurrentPosition ← vehicleSoc`<br>`PositionState = STOPPED` |
| `WindowCovering` | `limit-vehicle` | (only when `exposeVehicleLimit: true`)<br>`TargetPosition ↔ vehicles[vehicleName].limitSoc` |
| `Battery` | `vehicle-battery` | `BatteryLevel ← vehicleSoc`<br>`ChargingState ← charging`<br>`StatusLowBattery ← vehicleSoc < 20` |
| `LightSensor` | `charge-power` | `CurrentAmbientLightLevel ← chargePower` |
| `Switch` | `mode-now` / `mode-pv` / `mode-minpv` | (only when `loadpointMode: "switches"`)<br>`On ← mode === <mode>`<br>`onSet`: ON → set to `<mode>`, OFF (when active) → set to `off` |

Loadpoints disappearing from EVCC (e.g. user removed one from the EVCC config) are unregistered automatically on the next state poll.

## Vehicle presence accessory (one per known vehicle)

Display name: `vehicles[<name>].title`, falls back to `<name>`.

| Service | Subtype | Characteristic ← EVCC source |
|---|---|---|
| `AccessoryInformation` | – | `SerialNumber = <vehicle name slug>` |
| `OccupancySensor` | `vehicle-presence` | `OccupancyDetected ← any loadpoint where (connected && vehicleName === <this vehicle>)` |

Hide the entire row with `hideVehiclePresence: true`.

## Read-only mode

When no admin password is configured, the plugin runs read-only:

- All `onSet` handlers are simply not registered.
- The battery-mode switches on the site accessory are not added at all (rather than added but inert) — fewer phantom controls in the Home app.
- Loadpoint mode switches and the outlet `On` characteristic still appear, but flipping them does nothing.

To switch to read-only after configuring a password, simply remove the password from the plugin settings — restart Homebridge, the controls become inert.

## What the plugin does NOT expose (yet)

- Charging plans (`/loadpoints/{id}/plan/...`) — better managed through the EVCC UI.
- Static / repeating SOC plans on vehicles — same reason.
- Sessions / grid sessions / system logs — these are time-series records, awkward to fit into HAP.
- Tariff data — read-only and complex; HomeKit has no good display surface.

PRs welcome if you have a concrete automation use case that needs one of these.
