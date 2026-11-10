# Zuhause energy contract

This document is the contract between this plugin and apps that read EVCC energy data through HomeKit, in particular the Zuhause iOS app. HomeKit is the conduit: the app talks to the paired Homebridge bridge through Apple's HomeKit framework and never calls EVCC directly.

Standard HomeKit characteristics are used only where their meaning truly matches (for example `BatteryLevel` on the existing `Battery` service of the home battery). Everything else is a custom characteristic defined below. The Apple Home app ignores custom services, so they do not clutter it.

The source of truth for the definitions is [`src/energy/definitions.ts`](../src/energy/definitions.ts). A unit test fails when a UUID or name in that file is missing from this document.

## Rules that apply to every custom characteristic

- **Read-only, with notifications.** Every custom characteristic has the HAP permissions `pr` (paired read) and `ev` (notify). There are no new write controls; the existing controls (charge-limit sliders, mode outlet or switches, battery-mode switches) are unchanged.
- **UUIDs are stable.** They were generated once (2026-11-10) and are never changed or reused. All types share the suffix `-8B93-4652-90CD-F02EAF5356EA`; characteristics start with `E5C0`, services with `E5C1`. New data gets new UUIDs; a meaning never changes under an existing UUID.
- **Units.** The unit column is part of the contract. Only percentages carry a HAP unit (`percentage`); W, kWh, A, km, g/kWh, currency/kWh and timestamps are not encoded in the HAP metadata (HAP has no such units), so the app must take them from this table.
- **Energy is always kWh.** EVCC publishes some loadpoint counters in Wh (`sessionEnergy`, `todayEnergy`; the upstream OpenAPI text says kWh, the EVCC code publishes Wh). The plugin divides them by 1000.
- **Signs follow EVCC.** Grid power: positive is import from the grid, negative is export (feed-in). Battery power: positive is discharging (the battery supplies the home), negative is charging.
- **Rounding and range.** Values are rounded to the listed resolution and clamped to the listed range before they reach HAP.
- **Missing values.** When EVCC does not report a field, the characteristic reads `0`, `false` or `""`. To tell "not reported" from a real zero, use `Battery Configured`, `Grid Configured` and the presence of the per-meter services; to detect stale data, use `Last Update`.
- **Timestamps** are `uint32` seconds since 1970-01-01 UTC; `0` means "none".
- **Update rate.** The plugin applies EVCC's websocket frames as they arrive (EVCC publishes once per control cycle, set by EVCC's `interval`) and polls `GET /api/state` every `pollInterval` seconds (default 30) as a safety net. HAP sends a notification only when the rounded value changes. `Last Update` changes with every applied update.
- **Opt-out.** The plugin option `hideEnergyCharacteristics: true` removes all custom services. They are on by default.

## Where to find the services

| Accessory | How to recognise it | Custom services on it |
|---|---|---|
| Site (one per EVCC instance) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Site`, SerialNumber `evcc-site` | one `Energy Site`; one `PV Array` per entry of `pv[]`; one `Aux Meter` per entry of `aux[]`; one `Charging Statistics` per key of `statistics` |
| Loadpoint (one per EVCC loadpoint) | `AccessoryInformation`: Manufacturer `EVCC`, Model `Loadpoint`, SerialNumber `lp-<index>` (0-based) | one `Loadpoint Energy` |

The site accessory is absent when the plugin option `hideSite` is set.

iOS does not expose HAP service subtypes, so services of the same type are told apart by characteristics:

- `PV Array` and `Aux Meter`: `Meter ID` is the EVCC meter name (stable while the EVCC configuration is unchanged); the standard `Name` characteristic is the EVCC title (falls back to the meter name, then to `PV <n>` / `Aux <n>`).
- `Charging Statistics`: `Statistics Period` holds the EVCC period key.
- `Loadpoint Energy`: its `Name` is `<loadpoint title> Energy`; the accessory's SerialNumber gives the loadpoint index.

Per-meter and per-period services appear and disappear with the EVCC configuration (the HAP configuration number changes, and HomeKit reports the change to the app).

## Services

| Service | UUID | One per |
|---|---|---|
| Energy Site | `E5C10001-8B93-4652-90CD-F02EAF5356EA` | site |
| PV Array | `E5C10002-8B93-4652-90CD-F02EAF5356EA` | entry of `pv[]` |
| Aux Meter | `E5C10003-8B93-4652-90CD-F02EAF5356EA` | entry of `aux[]` |
| Loadpoint Energy | `E5C10004-8B93-4652-90CD-F02EAF5356EA` | loadpoint |
| Charging Statistics | `E5C10005-8B93-4652-90CD-F02EAF5356EA` | key of `statistics` |

Every custom service also carries the standard `Name` characteristic.

## Characteristics

The same characteristic type can appear in several services (for example `Meter Power` in `PV Array` and `Aux Meter`); its meaning is then defined by the service that contains it.

### Energy Site (`EnergySite`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign | EVCC source |
|---|---|---|---|---|---|---|---|
| PV Power (`PvPower`) | `E5C00010-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (normally >= 0) | `pvPower`; if absent, sum of `pv[].power` |
| PV Energy Total (`PvEnergyTotal`) | `E5C00011-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `pvEnergy`; if absent, sum of `pv[].energy` |
| Grid Power (`GridPower`) | `E5C00012-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import from grid, < 0 export to grid | `grid.power` |
| Grid Import Total (`GridEnergyImportTotal`) | `E5C00013-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `grid.energy` (meter total) |
| Grid Export Total (`GridEnergyExportTotal`) | `E5C00014-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `grid.returnEnergy` (meter total) |
| Grid Power L1 (`GridPowerL1`) | `E5C00015-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import, < 0 export | `grid.powers[0]` |
| Grid Power L2 (`GridPowerL2`) | `E5C00016-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import, < 0 export | `grid.powers[1]` |
| Grid Power L3 (`GridPowerL3`) | `E5C00017-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 import, < 0 export | `grid.powers[2]` |
| Grid Current L1 (`GridCurrentL1`) | `E5C00018-8B93-4652-90CD-F02EAF5356EA` | float | A | -1 000 .. 1 000 | 0.01 | as the meter reports it (signed meters: > 0 import) | `grid.currents[0]` |
| Grid Current L2 (`GridCurrentL2`) | `E5C00019-8B93-4652-90CD-F02EAF5356EA` | float | A | -1 000 .. 1 000 | 0.01 | as the meter reports it | `grid.currents[1]` |
| Grid Current L3 (`GridCurrentL3`) | `E5C0001A-8B93-4652-90CD-F02EAF5356EA` | float | A | -1 000 .. 1 000 | 0.01 | as the meter reports it | `grid.currents[2]` |
| Home Power (`HomePower`) | `E5C0001B-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | >= 0 | `homePower` |
| Aux Power (`AuxPower`) | `E5C0001C-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC | `auxPower`; if absent, sum of `aux[].power` |
| Battery Power (`BatteryPower`) | `E5C0001D-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | > 0 battery discharging, < 0 battery charging | `battery.power` |
| Battery SoC (`BatterySoc`) | `E5C0001E-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `battery.soc` (capacity weighted over all batteries) |
| Battery Capacity (`BatteryCapacity`) | `E5C0001F-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.capacity` |
| Battery Discharge Total (`BatteryEnergyDischargeTotal`) | `E5C00020-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.energy` (total discharged) |
| Battery Charge Total (`BatteryEnergyChargeTotal`) | `E5C00021-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `battery.returnEnergy` (total charged) |
| Battery Configured (`BatteryConfigured`) | `E5C00022-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | derived: `battery.devices` is non-empty; without a devices list, `battery.soc` is a number |
| Grid Configured (`GridConfigured`) | `E5C00023-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `gridConfigured`; if absent, `grid.power` is a number |
| Green Share Home (`GreenShareHome`) | `E5C00024-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `greenShareHome` (0..1) x 100 |
| Green Share Loadpoints (`GreenShareLoadpoints`) | `E5C00025-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `greenShareLoadpoints` (0..1) x 100 |
| Tariff Grid (`TariffGrid`) | `E5C00026-8B93-4652-90CD-F02EAF5356EA` | float | currency/kWh | -1 000 .. 1 000 | 0.0001 | can be negative with dynamic tariffs | `tariffGrid` |
| Tariff Feed-In (`TariffFeedIn`) | `E5C00027-8B93-4652-90CD-F02EAF5356EA` | float | currency/kWh | -1 000 .. 1 000 | 0.0001 |  | `tariffFeedIn` |
| Currency (`Currency`) | `E5C00028-8B93-4652-90CD-F02EAF5356EA` | string |  | max 8 chars |  |  | `currency` (ISO 4217 code, e.g. EUR) |
| Last Update (`LastUpdate`) | `E5C00029-8B93-4652-90CD-F02EAF5356EA` | uint32 | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 |  | plugin clock when it last applied EVCC data (REST poll or websocket frame) |

### PV Array (`PvArray`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign | EVCC source |
|---|---|---|---|---|---|---|---|
| Meter ID (`MeterId`) | `E5C00003-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `pv[i].name` / `aux[i].name` (EVCC meter name, empty if absent) |
| Meter Power (`MeterPower`) | `E5C00001-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (PV normally >= 0) | `pv[i].power` / `aux[i].power` |
| Meter Energy Total (`MeterEnergyTotal`) | `E5C00002-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `pv[i].energy` (meter total) |

### Aux Meter (`AuxMeter`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign | EVCC source |
|---|---|---|---|---|---|---|---|
| Meter ID (`MeterId`) | `E5C00003-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `pv[i].name` / `aux[i].name` (EVCC meter name, empty if absent) |
| Meter Power (`MeterPower`) | `E5C00001-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | as EVCC (PV normally >= 0) | `pv[i].power` / `aux[i].power` |

### Loadpoint Energy (`LoadpointEnergy`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign | EVCC source |
|---|---|---|---|---|---|---|---|
| Charge Power (`ChargePower`) | `E5C00040-8B93-4652-90CD-F02EAF5356EA` | float | W | -1 000 000 .. 1 000 000 | 0.1 | >= 0 | `loadpoints[i].chargePower` |
| Charge Mode (`ChargeMode`) | `E5C00041-8B93-4652-90CD-F02EAF5356EA` | string |  | max 16 chars |  |  | `loadpoints[i].mode`: `off`, `now`, `minpv`, `pv` (passed through, future EVCC modes included) |
| Vehicle Connected (`VehicleConnected`) | `E5C00042-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].connected` |
| Charging (`Charging`) | `E5C00043-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].charging` |
| Limit SoC (`LimitSoc`) | `E5C00044-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `loadpoints[i].limitSoc` (0 means no session limit) |
| Vehicle SoC (`VehicleSoc`) | `E5C00045-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `loadpoints[i].vehicleSoc` |
| Vehicle Range (`VehicleRange`) | `E5C00046-8B93-4652-90CD-F02EAF5356EA` | float | km | 0 .. 100 000 | 1 | >= 0 | `loadpoints[i].vehicleRange` |
| Vehicle Name (`VehicleName`) | `E5C00047-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `loadpoints[i].vehicleName` (key into `vehicles`) |
| Vehicle Title (`VehicleTitle`) | `E5C00048-8B93-4652-90CD-F02EAF5356EA` | string |  | max 64 chars |  |  | `loadpoints[i].vehicleTitle` |
| Session Energy (`SessionEnergy`) | `E5C00049-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].sessionEnergy` (Wh) / 1000 |
| Today Energy (`TodayEnergy`) | `E5C0004A-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].todayEnergy` (Wh) / 1000, since local midnight |
| Charge Meter Total (`ChargeMeterTotal`) | `E5C0004B-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `loadpoints[i].chargeTotalImport` (meter total) |
| Plan Time (`PlanTime`) | `E5C0004C-8B93-4652-90CD-F02EAF5356EA` | uint32 | s since 1970-01-01 UTC | 0 .. 4 294 967 295 | 1 |  | `loadpoints[i].effectivePlanTime`, else `planTime` (RFC 3339); 0 = no plan |
| Plan SoC (`PlanSoc`) | `E5C0004D-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `effectivePlanSoc` when the effective plan is used, else `planSoc`; 0 when there is no plan |
| Plan Active (`PlanActive`) | `E5C0004E-8B93-4652-90CD-F02EAF5356EA` | bool |  | true / false |  |  | `loadpoints[i].planActive` |

### Charging Statistics (`ChargingStatistics`)

| Characteristic | UUID | Format | Unit | Range | Resolution | Sign | EVCC source |
|---|---|---|---|---|---|---|---|
| Statistics Period (`StatPeriod`) | `E5C00060-8B93-4652-90CD-F02EAF5356EA` | string |  | max 16 chars |  |  | key of `statistics` (`30d`, `365d`, `thisYear`, `total`) |
| Charged Energy (`StatChargedEnergy`) | `E5C00061-8B93-4652-90CD-F02EAF5356EA` | float | kWh | 0 .. 1 000 000 000 | 0.001 | >= 0 | `statistics.<period>.chargedKWh` |
| Solar Percentage (`StatSolarPercentage`) | `E5C00062-8B93-4652-90CD-F02EAF5356EA` | float | % | 0 .. 100 | 0.1 |  | `statistics.<period>.solarPercentage` |
| Average Price (`StatAvgPrice`) | `E5C00063-8B93-4652-90CD-F02EAF5356EA` | float | currency/kWh | -1 000 .. 1 000 | 0.0001 |  | `statistics.<period>.avgPrice` |
| Average CO2 (`StatAvgCo2`) | `E5C00064-8B93-4652-90CD-F02EAF5356EA` | float | g/kWh | 0 .. 100 000 | 0.1 | >= 0 | `statistics.<period>.avgCo2` |

## Notes for consumers

- **Home battery level.** The existing standard `Battery` service (subtype `home-battery`) on the site accessory keeps `BatteryLevel = battery.soc` (rounded to an integer). `Battery SoC` above is the same value with 0.1 % resolution. The `Battery` service exists even when EVCC has no battery; check `Battery Configured`.
- **Do not read the classic Home-app services as data.** The existing `LightSensor` services (`pv-power`, `grid-power`, `home-power`, loadpoint `charge-power`) encode watts as lux for the Home app, and the `Grid Direction` contact sensor encodes the sign of the grid power. They stay for Home-app users, but apps should use the custom characteristics, which carry the real value, unit and sign.
- **Vehicle SoC on heating devices.** For loadpoints whose charger is a heating device, EVCC reports a temperature in `vehicleSoc`; `Vehicle SoC` is then not a state of charge (and is clamped to 0 .. 100).
- **"Today" counters for the site.** EVCC's `/api/state` has no daily site counters (PV, grid, battery); only the loadpoint `todayEnergy` exists. The site counters above are meter totals; daily values have to be derived by the consumer from the totals (difference to a stored midnight value).
- **Not exposed (yet).** Per-device battery values (`battery.devices[]`), forecasts, tariff time series, `planProjectedStart`/`planProjectedEnd`, vehicle capacity and the remaining fields of the state tree.
- **EVCC layout.** Field names were checked against a live EVCC (newer layout, no `result` wrapper) on 2026-11-10. The older layout with a `{ "result": ... }` wrapper is also accepted.
