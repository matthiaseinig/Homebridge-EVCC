/**
 * Map an arbitrary power value (watts) onto a HomeKit `CurrentAmbientLightLevel`
 * characteristic, which is constrained to `[0.0001, 100000]` lux. We keep the
 * mapping linear (1 W = 1 lux) and clamp to the legal range; this lets HomeKit
 * graph the value in the Home app and Eve app, and Eve users still see the
 * real wattage via the custom CurrentConsumption characteristic added to the
 * same accessory.
 *
 * Negative values (e.g. grid feed-in) are absoluted; direction is exposed via
 * a separate ContactSensor on the same accessory so the Home app can drive
 * automations off "exporting to grid" cleanly.
 */
export const HOMEKIT_LUX_MIN = 0.0001;
export const HOMEKIT_LUX_MAX = 100000;
export function powerToLux(watts) {
    if (watts === undefined || watts === null || !Number.isFinite(watts)) {
        return HOMEKIT_LUX_MIN;
    }
    const abs = Math.abs(watts);
    if (abs < HOMEKIT_LUX_MIN)
        return HOMEKIT_LUX_MIN;
    if (abs > HOMEKIT_LUX_MAX)
        return HOMEKIT_LUX_MAX;
    return abs;
}
/** Round a percentage value into the HAP-required `0..100` integer band. */
export function clampPercent(value) {
    if (value === undefined || value === null || !Number.isFinite(value))
        return 0;
    if (value < 0)
        return 0;
    if (value > 100)
        return 100;
    return Math.round(value);
}
//# sourceMappingURL=powerToLux.js.map