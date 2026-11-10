# Zuhause charging contract

This document is the contract between this plugin and apps that read and steer EVCC charging through HomeKit, in particular the Zuhause iOS app. HomeKit is the conduit: the app talks to the paired Homebridge bridge through Apple's HomeKit framework and never calls EVCC directly.

**Scope.** This plugin exposes charging: loadpoints, the connected vehicle and EVCC's charging statistics, plus the existing charging controls. It does **not** expose site energy (PV arrays, home battery, grid, house consumption, aux consumers); the app takes those from a dedicated inverter plugin. The custom site-energy types defined during development were retired before release and are listed under [Retired UUIDs](#retired-uuids).

Standard HomeKit characteristics are used only where their meaning truly matches. Everything else is a custom characteristic defined below. The Apple Home app ignores custom services and characteristics.

The source of truth is [`src/energy/definitions.ts`](../src/energy/definitions.ts). A unit test renders every table in this document from that file and fails on any missing, different or stale row.

## Rules for every custom characteristic

- **Read-only, with notifications.** Every custom characteristic has the HAP permissions `pr` (paired read) and `ev` (notify). Steering happens only through the existing standard controls described under [Charging controls](#charging-controls).
- **UUIDs are stable.** They were generated once (2026-11-10) and are never changed or reused, retired ones included. All types share the suffix `-8B93-4652-90CD-F02EAF5356EA`; characteristics start with `E5C0`, services with `E5C1`. New data gets new UUIDs; a meaning never changes under an existing UUID.
- **Units.** The unit column is part of the contract. Only percentages carry a HAP unit (`percentage`); W, kWh, km, g/kWh, currency/kWh and timestamps are not encoded in the HAP metadata (HAP has no such units), so the app must take them from this document.
- **Energy is always kWh.** EVCC publishes `sessionEnergy` and `todayEnergy` in Wh (the upstream OpenAPI text says kWh, the EVCC code publishes Wh); the plugin divides them by 1000.
- **Rounding and range.** Values are rounded to the listed resolution and clamped to the listed range before they reach HAP.
- **Missing values.** When EVCC does not report a field, the characteristic reads `0`, `false` or `""`.
- **Timestamps** are `uint32` seconds since 1970-01-01 UTC; `0` means "none".
- **Update rate.** The plugin applies EVCC's websocket frames as they arrive (EVCC publishes once per control cycle, set by EVCC's `interval`) and polls `GET /api/state` every `pollInterval` seconds (default 30) as a safety net. HAP sends a notification only when the rounded value changes.
- **Staleness.** `Last Update` on each `Loadpoint Energy` service changes whenever the plugin applies EVCC data for that loadpoint: on every REST poll and on every websocket frame for that loadpoint. Frames that only touch other parts of the EVCC state do not move it, so expect a change at least every `pollInterval` seconds while EVCC is reachable; an older value means the data is stale.
- **Opt-out.** The plugin option `hideEnergyCharacteristics: true` removes all custom services and the control tags. They are on by default.

## Where to find things

| Accessory | How to recognise it | Custom content |
|---|---|---|
| Loadpoint (one per EVCC loadpoint) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Loadpoint`, SerialNumber `lp-<index>` (0-based) | one `Loadpoint Energy` service; control tags on the standard control services |
| Site (one per EVCC instance) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Site`, SerialNumber `evcc-site` | one `Charging Statistics` service per key of EVCC `statistics` |
| Vehicle (one per EVCC vehicle) | `AccessoryInformation`: Manufacturer `EVCC`, SerialNumber `<vehicle name>` | none; standard `OccupancySensor` (vehicle connected at any loadpoint), useful as a car fallback |

The site accessory is absent when the plugin option `hideSite` is set, and its Charging Statistics services go with it. The vehicle accessories are absent with `hideVehiclePresence`.

iOS does not expose HAP service subtypes, so services of the same type are told apart by characteristics: `Charging Statistics` by `Statistics Period`; control services by `Control Role`. A statistics service whose period is missing from EVCC is kept until the period has been missing from 3 consecutive REST snapshots, so one incomplete payload does not remove it.

## Services

| Service | UUID |
|---|---|
| Loadpoint Energy (`LoadpointEnergy`) | `E5C10004-8B93-4652-90CD-F02EAF5356EA` |
| Charging Statistics (`ChargingStatistics`) | `E5C10005-8B93-4652-90CD-F02EAF5356EA` |

Every custom service also carries the standard `Name` characteristic (`<loadpoint title> Energy`, `Charging Statistics <period>`).

## Characteristics

### Loadpoint Energy (`LoadpointEnergy`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|
| Charge Power (`ChargePower`) | `E5C00040-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | >= 0 | `loadpoints[i].chargePower` |
| Charge Mode (`ChargeMode`) | `E5C00041-8B93-4652-90CD-F02EAF5356EA` | string |  | max 16 chars |  |  | `loadpoints[i].mode`: `off`, `now`, `minpv`, `pv` (passed through, future EVCC modes included) |
| Vehicle Connected (`VehicleConnected`) | `E5C00042-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].connected` |
| Charging (`Charging`) | `E5C00043-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].charging` |
| Limit SoC (`LimitSoc`) | `E5C00044-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 | 0 means no session limit | `loadpoints[i].limitSoc` |
| Vehicle SoC (`VehicleSoc`) | `E5C00045-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 | not a SoC for heating devices | `loadpoints[i].vehicleSoc` |
| Vehicle Range (`VehicleRange`) | `E5C00046-8B93-4652-90CD-F02EAF5356EA` | float | km | 0 .. 100 000 | 1 | >= 0 | `loadpoints[i].vehicleRange` |
| Vehicle Name (`VehicleName`) | `E5C00047-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `loadpoints[i].vehicleName` (key into `vehicles`) |
| Vehicle Title (`VehicleTitle`) | `E5C00048-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `loadpoints[i].vehicleTitle` |
| Session Energy (`SessionEnergy`) | `E5C00049-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].sessionEnergy` (Wh) / 1000 |
| Today Energy (`TodayEnergy`) | `E5C0004A-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].todayEnergy` (Wh) / 1000, since local midnight |
| Charge Meter Total (`ChargeMeterTotal`) | `E5C0004B-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].chargeTotalImport` (meter total) |
| Plan Time (`PlanTime`) | `E5C0004C-8B93-4652-90CD-F02EAF5356EA` | uint32 | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 | 0 = no plan | `loadpoints[i].effectivePlanTime`, else `planTime` (RFC 3339) |
| Plan SoC (`PlanSoc`) | `E5C0004D-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 | 0 = no plan | `effectivePlanSoc` when the effective plan is used, else `planSoc` |
| Plan Active (`PlanActive`) | `E5C0004E-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].planActive` |
| Last Update (`LastUpdate`) | `E5C0004F-8B93-4652-90CD-F02EAF5356EA` | uint32 | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 |  | plugin clock when it last applied EVCC data for this loadpoint (REST poll or a websocket frame for this loadpoint) |

### Charging Statistics (`ChargingStatistics`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|
| Statistics Period (`StatPeriod`) | `E5C00060-8B93-4652-90CD-F02EAF5356EA` | string |  | max 16 chars |  |  | key of `statistics` (`30d`, `365d`, `thisYear`, `total`) |
| Charged Energy (`StatChargedEnergy`) | `E5C00061-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `statistics.<period>.chargedKWh` |
| Solar Percentage (`StatSolarPercentage`) | `E5C00062-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `statistics.<period>.solarPercentage` |
| Average Price (`StatAvgPrice`) | `E5C00063-8B93-4652-90CD-F02EAF5356EA` | float | currency/kWh | -1 000 .. 1 000 | 0.0001 | configured currency | `statistics.<period>.avgPrice` |
| Average CO2 (`StatAvgCo2`) | `E5C00064-8B93-4652-90CD-F02EAF5356EA` | float | g/kWh | 0 .. 100 000 | 0.1 | >= 0 | `statistics.<period>.avgCo2` |

### Control tags

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|
| Control Role (`ControlRole`) | `E5C00070-8B93-4652-90CD-F02EAF5356EA` | string |  | max 32 chars |  |  | plugin constant per control service (see Charging controls) |
| Control Enabled (`ControlEnabled`) | `E5C00071-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | plugin config: admin password set and the control has a write handler |

The control tags are added to the existing standard control services; see [Charging controls](#charging-controls).

## Charging controls

Steering uses the plugin's existing standard HomeKit services; no new write controls were added. Each control service carries the two read-only control tags above: `Control Role` identifies it independently of its (title-based) name, and `Control Enabled` says whether a write is forwarded to EVCC. Writes need the EVCC admin password in the plugin config; without it, or for a control that has no write handler in the current configuration, `Control Enabled` is `false` and HomeKit accepts the write but nothing happens. `Control Enabled` reflects the configuration, not a successful login.

| Control Role | Standard service and characteristic | Present when | Write effect (EVCC REST, loadpoint id = index + 1) | Read-back from EVCC |
|---|---|---|---|---|
| `loadpoint-enable` | `Outlet`, `On` (bool) | always (writable only with `loadpointMode: "outlet"`) | `true`: `POST /api/loadpoints/{id}/mode/{defaultLoadpointMode}`; `false`: `POST /api/loadpoints/{id}/mode/off` | `On` = `enabled` (EVCC is currently allowed to charge, which can be false in `pv` mode without surplus); `OutletInUse` = `connected` |
| `loadpoint-mode-now` / `loadpoint-mode-pv` / `loadpoint-mode-minpv` | `Switch`, `On` (bool), one per mode | `loadpointMode: "switches"` | `true`: `POST /api/loadpoints/{id}/mode/{now, pv, minpv}`; `false` on the active mode: `mode/off`; `false` on an inactive mode: ignored | `On` = (`mode` equals this switch's mode) |
| `loadpoint-limit-soc` | `WindowCovering`, `TargetPosition` (0 .. 100 %, step 1) | always | `POST /api/loadpoints/{id}/limitsoc/{value}` (rounded) | `TargetPosition` = `limitSoc`; `CurrentPosition` = `vehicleSoc`; `PositionState` is always stopped |
| `vehicle-limit-soc` | `WindowCovering`, `TargetPosition` (0 .. 100 %, step 1) | `exposeVehicleLimit: true` | `POST /api/vehicles/{vehicleName}/limitsoc/{value}` for the vehicle currently at the loadpoint; ignored when no vehicle is assigned | none: the plugin does not update this slider from EVCC |

**How EVCC confirms a write.** The plugin acknowledges the HomeKit write at once and sends the REST call. EVCC applies it and publishes the new state on its websocket (or the next REST poll picks it up); the plugin then updates the standard characteristic and the read-only mirror in `Loadpoint Energy`: `Charge Mode` for mode writes, `Limit SoC` for limit writes. If EVCC rejects the call (for example HTTP 401 or unreachable), the failure is only logged in Homebridge and HomeKit is not told; the written value stays visible until the next EVCC update overwrites it with EVCC's actual value. Apps should therefore treat a write as confirmed only when the mirror shows the requested value, and as failed when it does not within `pollInterval` plus a few seconds.

**Recommended configuration for app steering:** admin password set and `loadpointMode: "switches"`. With the default `loadpointMode: "outlet"` the app can only switch between `off` and the configured `defaultLoadpointMode`.

**Not available.** Charging plans and departure times cannot be set through this plugin (`Plan Time`, `Plan SoC` and `Plan Active` are read-only mirrors); set them in EVCC. The vehicle limit has no read-back. The site accessory's existing battery-mode switches (`Battery normal / hold / charge`, only with a password) control the home battery through EVCC and are not part of this charging contract.

## Retired UUIDs

These were defined during development for site energy, never released, and must never be reused. Services with a retired UUID are removed from cached accessories.

| UUID | Kind | Former name |
|---|---|---|
| `E5C10001-8B93-4652-90CD-F02EAF5356EA` | service | Energy Site |
| `E5C10002-8B93-4652-90CD-F02EAF5356EA` | service | PV Array |
| `E5C10003-8B93-4652-90CD-F02EAF5356EA` | service | Aux Meter |
| `E5C00001-8B93-4652-90CD-F02EAF5356EA` | characteristic | Meter Power |
| `E5C00002-8B93-4652-90CD-F02EAF5356EA` | characteristic | Meter Energy Total |
| `E5C00003-8B93-4652-90CD-F02EAF5356EA` | characteristic | Meter ID |
| `E5C00010-8B93-4652-90CD-F02EAF5356EA` | characteristic | PV Power |
| `E5C00011-8B93-4652-90CD-F02EAF5356EA` | characteristic | PV Energy Total |
| `E5C00012-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Power |
| `E5C00013-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Import Total |
| `E5C00014-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Export Total |
| `E5C00015-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Power L1 |
| `E5C00016-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Power L2 |
| `E5C00017-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Power L3 |
| `E5C00018-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Current L1 |
| `E5C00019-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Current L2 |
| `E5C0001A-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Current L3 |
| `E5C0001B-8B93-4652-90CD-F02EAF5356EA` | characteristic | Home Power |
| `E5C0001C-8B93-4652-90CD-F02EAF5356EA` | characteristic | Aux Power |
| `E5C0001D-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery Power |
| `E5C0001E-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery SoC |
| `E5C0001F-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery Capacity |
| `E5C00020-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery Discharge Total |
| `E5C00021-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery Charge Total |
| `E5C00022-8B93-4652-90CD-F02EAF5356EA` | characteristic | Battery Configured |
| `E5C00023-8B93-4652-90CD-F02EAF5356EA` | characteristic | Grid Configured |
| `E5C00024-8B93-4652-90CD-F02EAF5356EA` | characteristic | Green Share Home |
| `E5C00025-8B93-4652-90CD-F02EAF5356EA` | characteristic | Green Share Loadpoints |
| `E5C00026-8B93-4652-90CD-F02EAF5356EA` | characteristic | Tariff Grid |
| `E5C00027-8B93-4652-90CD-F02EAF5356EA` | characteristic | Tariff Feed-In |
| `E5C00028-8B93-4652-90CD-F02EAF5356EA` | characteristic | Currency |
| `E5C00029-8B93-4652-90CD-F02EAF5356EA` | characteristic | Last Update |

## Notes for consumers

- **Vehicle data.** `Vehicle SoC`, `Vehicle Range`, `Vehicle Name` and `Vehicle Title` describe the vehicle at the loadpoint; use them as a fallback when the car's own integration has no data. For loadpoints whose charger is a heating device, EVCC reports a temperature in `vehicleSoc`; `Vehicle SoC` is then not a state of charge (and is clamped to 0 .. 100).
- **Do not read the classic Home-app services as data.** The existing `LightSensor` services (loadpoint `charge-power`; on the site accessory `pv-power`, `grid-power`, `home-power`) encode watts as lux, and the site `Grid Direction` contact sensor and `Home Battery` service remain for Home-app users. Site energy comes from the inverter plugin; charge power comes from `Charge Power`.
- **EVCC layout.** Field names were checked against a live EVCC (newer layout, no `result` wrapper) on 2026-11-10. The older layout with a `{ "result": ... }` wrapper is also accepted.
