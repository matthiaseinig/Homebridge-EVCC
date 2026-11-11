# Zuhause energy and charging contract

This document is the contract between this plugin and apps that read EVCC data and steer EVCC charging through HomeKit, in particular the Zuhause iOS app. HomeKit is the conduit: the app talks to the paired Homebridge bridge through Apple's HomeKit framework and never calls EVCC directly.

The plugin exposes two groups of custom data:

- **Site energy** (PV, PV arrays, grid, home, aux consumers, home battery, tariffs): read-only.
- **Charging** (loadpoints, the connected vehicle, charging statistics) plus the charging controls.

Standard HomeKit characteristics are used only where their meaning truly matches. Everything else is a custom characteristic defined below. The Apple Home app ignores custom services and characteristics.

The source of truth is [`src/energy/definitions.ts`](../src/energy/definitions.ts). A unit test renders every table in this document from that file and fails on any missing, different or stale row.

## Data ownership in Zuhause

Zuhause reads site energy from the Fronius plugin first and uses this plugin's site energy services only as a fallback when the Fronius plugin is absent. At runtime every value has exactly one owner, chosen by the app; the app never mixes or adds values from both sources. Charging data and charging control always come from this plugin.

## Rules for every custom characteristic

- **Access.** Every custom characteristic is paired read plus notify. Only `Charge Mode` and `Set Plan` are also paired write; see [Charging controls](#charging-controls).
- **UUIDs are stable.** They were generated once (2026-11-10) and are never changed or reused. All types share the suffix `-8B93-4652-90CD-F02EAF5356EA`; characteristics start with `E5C0`, services with `E5C1`. New data gets new UUIDs; a meaning never changes under an existing UUID.
- **Units.** The unit column is part of the contract. Only percentages carry a HAP unit (`percentage`); W, kWh, A, km, g/kWh, currency/kWh and timestamps are not encoded in the HAP metadata (HAP has no such units), so the app must take them from this document.
- **Energy is always kWh.** EVCC publishes `sessionEnergy` and `todayEnergy` in Wh (the upstream OpenAPI text says kWh, the EVCC code publishes Wh); the plugin divides them by 1000.
- **Rounding and range.** Values are rounded to the listed resolution and clamped to the listed range before they reach HAP.
- **Missing values.** When EVCC does not report a field, the characteristic reads `0`, `false` or `""`.
- **Timestamps** are `uint32` seconds since 1970-01-01 UTC; `0` means "none".
- **Update rate.** The plugin applies EVCC's websocket frames as they arrive (EVCC publishes once per control cycle, set by EVCC's `interval`) and polls `GET /api/state` every `pollInterval` seconds (default 30) as a safety net. HAP sends a notification only when the rounded value changes.
- **Repeated services** (PV Array, Aux Meter, Charging Statistics) are keyed by an EVCC name, never by an array position, so reordering the EVCC configuration does not move a service to another meter. A service whose entry is missing from EVCC is kept until the entry has been missing from 3 consecutive REST snapshots; websocket frames never remove a service.
- **Opt-out.** The plugin option `hideEnergyCharacteristics: true` (default `false`) removes all custom services and the control tags.

## Where to find things

| Accessory | How to recognise it | Custom content |
|---|---|---|
| Site (one per EVCC instance) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Site`, SerialNumber `evcc-site` | site energy: one `Energy Site`, one `PV Array` per `pv[]` meter, one `Aux Meter` per `aux[]` meter; charging: one `Charging Statistics` per key of `statistics` |
| Loadpoint (one per EVCC loadpoint) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Loadpoint`, SerialNumber `lp-<index>` (0-based) | one `Loadpoint Energy`; control tags on it and on the standard control services |
| Vehicle (one per EVCC vehicle) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Vehicle`, SerialNumber `<vehicle name>` | none; standard `OccupancySensor` (vehicle connected at any loadpoint), useful as a car fallback |

The site accessory is absent with the plugin option `hideSite`, the vehicle accessories with `hideVehiclePresence`.

iOS does not expose HAP service subtypes, so services of the same type are told apart by characteristics: `PV Array` and `Aux Meter` by `Meter ID`; `Charging Statistics` by `Statistics Period`; control services by `Control Role`. Every custom service also carries the standard `Name` characteristic (`Energy Site`, the meter title, `<loadpoint title> Energy`, `Charging Statistics <period>`).

## Services

| Service | UUID | Section |
|---|---|---|
| Energy Site (`EnergySite`) | `E5C10001-8B93-4652-90CD-F02EAF5356EA` | site energy |
| PV Array (`PvArray`) | `E5C10002-8B93-4652-90CD-F02EAF5356EA` | site energy |
| Aux Meter (`AuxMeter`) | `E5C10003-8B93-4652-90CD-F02EAF5356EA` | site energy |
| Loadpoint Energy (`LoadpointEnergy`) | `E5C10004-8B93-4652-90CD-F02EAF5356EA` | charging |
| Charging Statistics (`ChargingStatistics`) | `E5C10005-8B93-4652-90CD-F02EAF5356EA` | charging |

## Site energy

Read-only. For Zuhause this is the fallback source (see [Data ownership](#data-ownership-in-zuhause)).

- **Signs follow EVCC.** Grid power: positive is import from the grid, negative is export (feed-in). Battery power: positive is discharging (the battery supplies the home), negative is charging.
- **Not reported versus zero.** Use `Battery Configured`, `Grid Configured` and the presence of the per-meter services to tell "not configured" from a real zero.
- **Staleness.** `Last Update` on `Energy Site` changes whenever the plugin applies any EVCC data: every REST poll and every websocket frame, including frames that only touch a loadpoint.
- **Meter keys.** `PV Array` and `Aux Meter` are keyed by the EVCC meter `name`; a meter without a name is keyed by its `title`; a meter with neither, or with a key already used by another meter, gets no service.
- **Daily values.** EVCC's `/api/state` has no daily site counters; the site counters are meter totals, so daily values have to be derived from the totals.

### Energy Site (`EnergySite`)

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| PV Power (`PvPower`) | `E5C00010-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (normally >= 0) | `pvPower`; if absent, sum of `pv[].power` |
| PV Energy Total (`PvEnergyTotal`) | `E5C00011-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `pvEnergy`; if absent, sum of `pv[].energy` |
| Grid Power (`GridPower`) | `E5C00012-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import from grid, < 0 export to grid | `grid.power` |
| Grid Import Total (`GridEnergyImportTotal`) | `E5C00013-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `grid.energy` (meter total) |
| Grid Export Total (`GridEnergyExportTotal`) | `E5C00014-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `grid.returnEnergy` (meter total) |
| Grid Power L1 (`GridPowerL1`) | `E5C00015-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import from grid, < 0 export to grid | `grid.powers[0]` |
| Grid Power L2 (`GridPowerL2`) | `E5C00016-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import from grid, < 0 export to grid | `grid.powers[1]` |
| Grid Power L3 (`GridPowerL3`) | `E5C00017-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import from grid, < 0 export to grid | `grid.powers[2]` |
| Grid Current L1 (`GridCurrentL1`) | `E5C00018-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | A | -1 000 .. 1 000 | 0.01 | as the meter reports it | `grid.currents[0]` |
| Grid Current L2 (`GridCurrentL2`) | `E5C00019-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | A | -1 000 .. 1 000 | 0.01 | as the meter reports it | `grid.currents[1]` |
| Grid Current L3 (`GridCurrentL3`) | `E5C0001A-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | A | -1 000 .. 1 000 | 0.01 | as the meter reports it | `grid.currents[2]` |
| Home Power (`HomePower`) | `E5C0001B-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | >= 0 | `homePower` |
| Aux Power (`AuxPower`) | `E5C0001C-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC | `auxPower`; if absent, sum of `aux[].power` |
| Battery Power (`BatteryPower`) | `E5C0001D-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 battery discharging, < 0 battery charging | `battery.power` |
| Battery SoC (`BatterySoc`) | `E5C0001E-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 |  | `battery.soc` (capacity weighted over all batteries) |
| Battery Capacity (`BatteryCapacity`) | `E5C0001F-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.capacity` |
| Battery Discharge Total (`BatteryEnergyDischargeTotal`) | `E5C00020-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.energy` (total discharged) |
| Battery Charge Total (`BatteryEnergyChargeTotal`) | `E5C00021-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.returnEnergy` (total charged) |
| Battery Configured (`BatteryConfigured`) | `E5C00022-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | derived: `battery.devices` is non-empty; without a devices list, `battery.soc` is a number |
| Grid Configured (`GridConfigured`) | `E5C00023-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | `gridConfigured`; if absent, `grid.power` is a number |
| Green Share Home (`GreenShareHome`) | `E5C00024-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 |  | `greenShareHome` (0..1) x 100 |
| Green Share Loadpoints (`GreenShareLoadpoints`) | `E5C00025-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 |  | `greenShareLoadpoints` (0..1) x 100 |
| Tariff Grid (`TariffGrid`) | `E5C00026-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | currency/kWh | -1 000 .. 1 000 | 0.0001 | can be negative with dynamic tariffs | `tariffGrid` |
| Tariff Feed-In (`TariffFeedIn`) | `E5C00027-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | currency/kWh | -1 000 .. 1 000 | 0.0001 |  | `tariffFeedIn` |
| Currency (`Currency`) | `E5C00028-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 8 chars |  |  | `currency` (ISO 4217 code) |
| Last Update (`LastUpdate`) | `E5C00029-8B93-4652-90CD-F02EAF5356EA` | uint32 | read, notify | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 |  | plugin clock when it last applied any EVCC data (REST poll or any websocket frame) |

### PV Array (`PvArray`)

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| Meter ID (`MeterId`) | `E5C00003-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 64 chars |  |  | `pv[i].name` / `aux[i].name` (EVCC meter name; `title` when the name is missing) |
| Meter Power (`MeterPower`) | `E5C00001-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (PV normally >= 0) | `pv[i].power` / `aux[i].power` |
| Meter Energy Total (`MeterEnergyTotal`) | `E5C00002-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `pv[i].energy` (meter total) |

### Aux Meter (`AuxMeter`)

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| Meter ID (`MeterId`) | `E5C00003-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 64 chars |  |  | `pv[i].name` / `aux[i].name` (EVCC meter name; `title` when the name is missing) |
| Meter Power (`MeterPower`) | `E5C00001-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (PV normally >= 0) | `pv[i].power` / `aux[i].power` |

## Charging

Charging data and the charging controls. `Loadpoint Last Update` changes whenever the plugin applies EVCC data for that loadpoint: on every REST poll and every websocket frame for that loadpoint.

### Loadpoint Energy (`LoadpointEnergy`)

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| Charge Power (`ChargePower`) | `E5C00040-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | W | -1 000 000 .. 1 000 000 | 0.1 | >= 0 | `loadpoints[i].chargePower` |
| Charge Mode (`ChargeMode`) | `E5C00041-8B93-4652-90CD-F02EAF5356EA` | string | read, write, notify |  | max 16 chars |  |  | `loadpoints[i].mode`; write: `off`, `now`, `smart`, `minpv` or `pv` |
| Vehicle Connected (`VehicleConnected`) | `E5C00042-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | `loadpoints[i].connected` |
| Charging (`Charging`) | `E5C00043-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | `loadpoints[i].charging` |
| Limit SoC (`LimitSoc`) | `E5C00044-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 | 0 means no session limit | `loadpoints[i].limitSoc` |
| Vehicle SoC (`VehicleSoc`) | `E5C00045-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 | not a SoC for heating devices | `loadpoints[i].vehicleSoc` |
| Vehicle Range (`VehicleRange`) | `E5C00046-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | km | 0 .. 100 000 | 1 | >= 0 | `loadpoints[i].vehicleRange` |
| Vehicle Name (`VehicleName`) | `E5C00047-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 64 chars |  |  | `loadpoints[i].vehicleName` (key into `vehicles`) |
| Vehicle Title (`VehicleTitle`) | `E5C00048-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 64 chars |  |  | `loadpoints[i].vehicleTitle` |
| Session Energy (`SessionEnergy`) | `E5C00049-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].sessionEnergy` (Wh) / 1000 |
| Today Energy (`TodayEnergy`) | `E5C0004A-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].todayEnergy` (Wh) / 1000, since local midnight |
| Charge Meter Total (`ChargeMeterTotal`) | `E5C0004B-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].chargeTotalImport` (meter total) |
| Plan Time (`PlanTime`) | `E5C0004C-8B93-4652-90CD-F02EAF5356EA` | uint32 | read, notify | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 | 0 = no plan | `loadpoints[i].effectivePlanTime`, else `planTime` (RFC 3339) |
| Plan SoC (`PlanSoc`) | `E5C0004D-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 | 0 = no plan | `effectivePlanSoc` when the effective plan is used, else `planSoc` |
| Plan Active (`PlanActive`) | `E5C0004E-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | `loadpoints[i].planActive` |
| Loadpoint Last Update (`LoadpointLastUpdate`) | `E5C0004F-8B93-4652-90CD-F02EAF5356EA` | uint32 | read, notify | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 |  | plugin clock when it last applied EVCC data for this loadpoint (REST poll or a websocket frame for this loadpoint) |
| Set Plan (`SetPlan`) | `E5C00050-8B93-4652-90CD-F02EAF5356EA` | string | read, write, notify |  | max 32 chars |  | empty = no plan | read: `<Plan SoC>,<Plan Time>` or empty; write: see Charging controls |

### Charging Statistics (`ChargingStatistics`)

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| Statistics Period (`StatPeriod`) | `E5C00060-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 16 chars |  |  | key of `statistics` (`30d`, `365d`, `thisYear`, `total`) |
| Charged Energy (`StatChargedEnergy`) | `E5C00061-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `statistics.<period>.chargedKWh` |
| Solar Percentage (`StatSolarPercentage`) | `E5C00062-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | % | 0 .. 100 | 0.1 |  | `statistics.<period>.solarPercentage` |
| Average Price (`StatAvgPrice`) | `E5C00063-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | currency/kWh | -1 000 .. 1 000 | 0.0001 | configured currency | `statistics.<period>.avgPrice` |
| Average CO2 (`StatAvgCo2`) | `E5C00064-8B93-4652-90CD-F02EAF5356EA` | float | read, notify | g/kWh | 0 .. 100 000 | 0.1 | >= 0 | `statistics.<period>.avgCo2` |

### Control tags

| Characteristic | UUID | Format | Access | Unit | Range | Resolution | Sign or domain | EVCC source |
|---|---|---|---|---|---|---|---|---|
| Control Role (`ControlRole`) | `E5C00070-8B93-4652-90CD-F02EAF5356EA` | string | read, notify |  | max 32 chars |  |  | plugin constant per control service (see Charging controls) |
| Control Enabled (`ControlEnabled`) | `E5C00071-8B93-4652-90CD-F02EAF5356EA` | bool | read, notify |  | true / false |  |  | plugin config: admin password set and the control accepts writes |

The control tags are added to the `Loadpoint Energy` service and to the existing standard control services; see [Charging controls](#charging-controls).

### Charging controls

Writes need the EVCC admin password in the plugin config. `Control Role` identifies a control independently of its title-based name; `Control Enabled` is `true` when the control accepts writes (password configured, `loadpointMode` not `readonly`, and for the outlet `loadpointMode: "outlet"`). It reflects the configuration, not a successful login.

| Control Role | Service and characteristic | Present when | Write effect (EVCC REST, loadpoint id = index + 1) | Read-back from EVCC |
|---|---|---|---|---|
| `loadpoint-charging` | `Loadpoint Energy`, `Charge Mode` (string) | always | `off`, `now`, `smart`, `minpv` or `pv` (`minpv` and `pv` are deprecated in EVCC and normalized to `smart`): `POST /api/loadpoints/{id}/mode/{mode}`; any other value is rejected | `Charge Mode` = `mode` |
| `loadpoint-charging` | `Loadpoint Energy`, `Set Plan` (string) | always | `"<soc>,<epoch seconds>"` (soc an integer 1 .. 100, time in the future): `POST /api/vehicles/{vehicleName}/plan/soc/{soc}/{RFC 3339 UTC time}`; `""` or `"0"`: `DELETE /api/vehicles/{vehicleName}/plan/soc`. `vehicleName` is the vehicle currently at the loadpoint (EVCC keeps SoC plans per vehicle) | `Set Plan` = `<Plan SoC>,<Plan Time>`; `Plan Time`, `Plan SoC`, `Plan Active` |
| `loadpoint-enable` | `Outlet`, `On` (bool) | always (accepts writes only with `loadpointMode: "outlet"`) | `true`: `POST /api/loadpoints/{id}/mode/{defaultLoadpointMode}`; `false`: `POST /api/loadpoints/{id}/mode/off` | `On` = `enabled` (EVCC is currently allowed to charge, which can be false in `pv` mode without surplus); `OutletInUse` = `connected`; confirm via `Charge Mode` |
| `loadpoint-mode-now` / `loadpoint-mode-pv` / `loadpoint-mode-minpv` | `Switch`, `On` (bool), one per mode | `loadpointMode: "switches"` | `true`: `POST /api/loadpoints/{id}/mode/{now, pv, minpv}`; `false` on the active mode: `mode/off`; `false` on an inactive mode: ignored | `On` = (`mode` equals this switch's mode) |
| `loadpoint-limit-soc` | `WindowCovering`, `TargetPosition` (0 .. 100 %, step 1) | always | `POST /api/loadpoints/{id}/limitsoc/{value}` (rounded; 0 clears the session limit) | `TargetPosition` = `limitSoc`, mirrored in `Limit SoC`; `CurrentPosition` = `vehicleSoc` |
| `vehicle-limit-soc` | `WindowCovering`, `TargetPosition` (0 .. 100 %, step 1) | `exposeVehicleLimit: true` | `POST /api/vehicles/{vehicleName}/limitsoc/{value}`; ignored when no vehicle is assigned | none: the plugin does not update this slider from EVCC |

**Write results.** Every write is validated before EVCC is called. The HomeKit write completes only after EVCC answered:

| Situation | HAP status returned to the app |
|---|---|
| EVCC accepted the call (2xx) | success |
| EVCC rejected it (non-2xx, for example 401) or was unreachable (network error, 10 s timeout) | `SERVICE_COMMUNICATION_FAILURE` (-70402) |
| `Charge Mode` or `Set Plan` value fails validation | `INVALID_VALUE_IN_REQUEST` (-70410) |
| `Set Plan` while no vehicle is at the loadpoint | `NOT_ALLOWED_IN_CURRENT_STATE` (-70412) |
| `Charge Mode` or `Set Plan` while `Control Enabled` is `false` | `INSUFFICIENT_PRIVILEGES` (-70401) |

The communication failure applies to every write path of the plugin (outlet, mode switches, both limit sliders, `Charge Mode`, `Set Plan`, and the site's battery-mode switches). In the Apple Home app it shows as "No Response" on the tile. After a failure the characteristic keeps its previous value. After a success, EVCC publishes the new state on its websocket (or the next poll picks it up) and the read-back characteristics follow.

**Recommended configuration for app steering:** admin password set. `Charge Mode` and `Set Plan` work with any `loadpointMode` except `readonly`.

**Not available.** Energy-based plans (EVCC's `plan/energy`, for vehicles without SoC) and repeating plans cannot be set; set them in EVCC. `Set Plan` reads the effective plan, which can be a repeating plan; writing it creates a one-off plan. The vehicle limit has no read-back. The site's battery-mode switches control the home battery through EVCC and are not charging controls.

## Notes for consumers

- **Home battery level.** The existing standard `Battery` service (subtype `home-battery`) on the site accessory keeps `BatteryLevel = battery.soc` (rounded to an integer). `Battery SoC` is the same value with 0.1 % resolution. The `Battery` service exists even when EVCC has no battery; check `Battery Configured`.
- **Vehicle data.** `Vehicle SoC`, `Vehicle Range`, `Vehicle Name` and `Vehicle Title` describe the vehicle at the loadpoint; use them as a fallback when the car's own integration has no data. For loadpoints whose charger is a heating device, EVCC reports a temperature in `vehicleSoc`; `Vehicle SoC` is then not a state of charge (and is clamped to 0 .. 100).
- **Do not read the classic Home-app services as data.** The existing `LightSensor` services (`pv-power`, `grid-power`, `home-power`, loadpoint `charge-power`) encode watts as lux for the Home app, and the `Grid Direction` contact sensor encodes the sign of the grid power.
- **EVCC layout.** Field names were checked against a live EVCC (newer layout, no `result` wrapper) on 2026-11-10. The older layout with a `{ "result": ... }` wrapper is also accepted. The plan endpoints follow the EVCC REST API reference (`docs.evcc.io` OpenAPI).
