import type { Service, WithUUID } from "homebridge";

/**
 * Force a descriptive label on a service in three layers:
 *
 *  - `service.displayName` so HAP-NodeJS persists it in the accessory cache.
 *  - `Name` characteristic so HAP exposes it in the accessory description.
 *  - `ConfiguredName` (when supported), with an onSet handler that swallows
 *    the iOS-generated writes from the "Camera Details" pairing dialog
 *    ("Motion Sensor", "Occupancy Sensor 2", "Switch", …). Without this
 *    interception, iOS Home permanently overwrites our label the moment the
 *    user taps "Continue" through that dialog.
 */
export function applyServiceName(
  service: Service,
  name: string,
  Characteristic: { Name: WithUUID<unknown>; ConfiguredName?: WithUUID<unknown> },
): void {
  (service as Service & { displayName: string }).displayName = name;
  service.setCharacteristic(Characteristic.Name as never, name);
  if (Characteristic.ConfiguredName) {
    const c = service.getCharacteristic(Characteristic.ConfiguredName as never);
    c.updateValue(name);
    c.onSet(() => {
      // Intentionally a no-op. iOS's pairing flow tries to write generic
      // labels back to ConfiguredName, and any user attempt to rename via the
      // Home app would also land here — we keep the plugin-controlled name so
      // automations and labels stay coherent across re-pairings.
    });
  }
}
