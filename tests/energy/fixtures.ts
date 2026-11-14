import type { EvccState } from "../../src/api/types.js";

/**
 * Invented `/api/state` payload in the newer (unwrapped) layout. Names, titles
 * and numbers are made up for tests and do not describe any real installation.
 */
export function energyFixture(): EvccState {
  return {
    siteTitle: "Test Site",
    currency: "EUR",
    pv: [
      { name: "pv1", title: "Array A", power: 2100.44, energy: 1234.5678 },
      { name: "pv2", title: "Array B", power: 950, energy: 456.1 },
    ],
    pvPower: 3050,
    pvEnergy: 1690.6678,
    battery: {
      power: -800,
      energy: 300.25,
      returnEnergy: 320.5,
      capacity: 10,
      soc: 55.55,
      devices: [{ power: -800, capacity: 10, soc: 55.55 }],
    },
    grid: {
      power: -1250.06,
      energy: 2000.123,
      returnEnergy: 1500.987,
      powers: [-400.1, -425, -424.96],
      currents: [-1.744, -1.85, -1.849],
    },
    gridConfigured: true,
    homePower: 1000,
    aux: [{ name: "aux1", title: "Aux A", power: 120 }],
    auxPower: 120,
    greenShareHome: 0.875,
    greenShareLoadpoints: 1,
    tariffGrid: 0.3012,
    tariffFeedIn: 0.081,
    statistics: {
      "30d": { avgCo2: 210.5, avgPrice: 0.21, chargedKWh: 150.5, solarPercentage: 62.3 },
      total: { avgCo2: 250, avgPrice: 0.25, chargedKWh: 4000.25, solarPercentage: 48.2 },
    },
    loadpoints: [
      {
        title: "Loadpoint A",
        mode: "pv",
        connected: true,
        charging: true,
        enabled: true,
        chargePower: 3700,
        sessionEnergy: 5432,
        todayEnergy: 7650,
        chargeTotalImport: 987.654,
        limitSoc: 80,
        vehicleSoc: 42,
        vehicleRange: 180,
        vehicleName: "car1",
        vehicleTitle: "Car One",
        effectivePlanTime: "2030-01-02T06:30:00Z",
        effectivePlanSoc: 90,
        planTime: null,
        planActive: false,
      },
    ],
    vehicles: { car1: { title: "Car One" } },
  } as unknown as EvccState;
}

/** Epoch seconds of `effectivePlanTime` in the fixture. */
export const FIXTURE_PLAN_EPOCH = Date.UTC(2030, 0, 2, 6, 30, 0) / 1000;
