import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** Placeholder sessions in the shape of EVCC's `GET /api/sessions` (all values invented). */
export function rawSession(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    created: "2026-03-10T08:00:00Z",
    finished: "2026-03-10T10:00:00Z",
    loadpoint: "Garage",
    identifier: "",
    vehicle: "Car A",
    odometer: 12000.5,
    meterStartKwh: 100,
    meterStopKwh: 110,
    chargedEnergy: 10,
    chargeDuration: 7_200_000_000_000,
    solarPercentage: 50,
    price: 2.5,
    pricePerKWh: 0.25,
    co2PerKWh: 120,
    ...over,
  };
}

const dirs: string[] = [];

/** A private temp folder with a specific prefix, removed after each test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "evcc-sessions-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
