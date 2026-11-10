"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.energyHapTypes = energyHapTypes;
exports.servicesOfType = servicesOfType;
exports.ensureEnergyService = ensureEnergyService;
exports.ensureCustomCharacteristic = ensureCustomCharacteristic;
exports.removeCustomCharacteristic = removeCustomCharacteristic;
exports.pruneRetiredServices = pruneRetiredServices;
exports.setServiceName = setServiceName;
exports.applyValues = applyValues;
exports.pruneServices = pruneServices;
const definitions_js_1 = require("./definitions.js");
const sanitize_js_1 = require("./sanitize.js");
const cache = new WeakMap();
const verifiedServices = new WeakSet();
function toProps(hap, def) {
    const props = {
        format: {
            float: "float" /* hap.Formats.FLOAT */,
            uint32: "uint32" /* hap.Formats.UINT32 */,
            bool: "bool" /* hap.Formats.BOOL */,
            string: "string" /* hap.Formats.STRING */,
        }[def.format],
        perms: ["pr" /* hap.Perms.PAIRED_READ */, "ev" /* hap.Perms.NOTIFY */],
    };
    // Only "%" has a HAP unit. Other units (W, kWh, A, ...) are omitted from the
    // HAP metadata on purpose and documented in the contract instead.
    if (def.unit === "%")
        props.unit = "percentage" /* hap.Units.PERCENTAGE */;
    if (def.min !== undefined)
        props.minValue = def.min;
    if (def.max !== undefined)
        props.maxValue = def.max;
    if (def.maxLen !== undefined)
        props.maxLen = def.maxLen;
    return props;
}
function defaultValue(def) {
    return (0, sanitize_js_1.sanitize)(def, undefined);
}
/**
 * Build (once per HAP instance) the custom characteristic and service classes.
 * They must extend the HAP classes Homebridge hands us at runtime, so they are
 * created dynamically rather than declared at module level.
 */
function energyHapTypes(hap) {
    const cached = cache.get(hap);
    if (cached)
        return cached;
    const chars = new Map();
    const services = new Map();
    const propsByKey = new Map();
    const props = (key) => {
        let p = propsByKey.get(key);
        if (!p) {
            p = toProps(hap, definitions_js_1.CHARS[key]);
            propsByKey.set(key, p);
        }
        return p;
    };
    const char = (key) => {
        let ctor = chars.get(key);
        if (!ctor) {
            const def = definitions_js_1.CHARS[key];
            const p = props(key);
            ctor = class extends hap.Characteristic {
                static UUID = def.uuid;
                constructor() {
                    super(def.name, def.uuid, { ...p });
                    this.value = defaultValue(def);
                }
            };
            chars.set(key, ctor);
        }
        return ctor;
    };
    const service = (key) => {
        let ctor = services.get(key);
        if (!ctor) {
            const def = definitions_js_1.SERVICES[key];
            ctor = class extends hap.Service {
                static UUID = def.uuid;
                constructor(displayName, subtype) {
                    super(displayName, def.uuid, subtype);
                    for (const k of def.chars)
                        this.addCharacteristic(char(k));
                }
            };
            services.set(key, ctor);
        }
        return ctor;
    };
    const types = { char, props, service };
    cache.set(hap, types);
    return types;
}
/** All services of `accessory` whose type UUID matches `ctor`. */
function servicesOfType(accessory, ctor) {
    return accessory.services.filter((s) => s.UUID === ctor.UUID);
}
/**
 * Find or create a custom service, then make sure it carries every declared
 * characteristic. Services restored from the Homebridge cache are plain HAP
 * services, so characteristics added in a later plugin version are added here
 * and the declared props are re-applied.
 */
function ensureEnergyService(hap, accessory, key, name, subtype) {
    const types = energyHapTypes(hap);
    const ctor = types.service(key);
    const svc = servicesOfType(accessory, ctor).find((s) => s.subtype === subtype) ??
        accessory.addService(ctor, name, subtype);
    // The characteristic set only needs checking once per service instance; the
    // accessories re-render on every websocket frame.
    if (!verifiedServices.has(svc)) {
        for (const k of definitions_js_1.SERVICES[key].chars)
            ensureCustomCharacteristic(hap, svc, k);
        verifiedServices.add(svc);
    }
    setServiceName(hap, svc, name);
    return svc;
}
/**
 * Make sure `svc` (custom or standard, fresh or restored from the cache)
 * carries the custom characteristic `key` with its declared props. Adding it
 * explicitly avoids HAP's "not in required or optional characteristics"
 * warning.
 */
function ensureCustomCharacteristic(hap, svc, key) {
    const types = energyHapTypes(hap);
    const c = types.char(key);
    const present = svc.characteristics.some((x) => x.UUID === c.UUID);
    const characteristic = present ? svc.getCharacteristic(c) : svc.addCharacteristic(c);
    characteristic.setProps(types.props(key));
    return characteristic;
}
/** Remove the custom characteristic `key` from `svc` if it is present. */
function removeCustomCharacteristic(svc, key) {
    const uuid = definitions_js_1.CHARS[key].uuid;
    const existing = svc.characteristics.find((x) => x.UUID === uuid);
    if (existing)
        svc.removeCharacteristic(existing);
}
/** Remove services whose type UUID is retired (see RETIRED in definitions.ts). */
function pruneRetiredServices(accessory) {
    const services = accessory.services;
    for (const svc of [...services]) {
        if (svc.UUID in definitions_js_1.RETIRED.services)
            accessory.removeService(svc);
    }
}
/** Keep the HAP Name characteristic (and the cached display name) in sync. */
function setServiceName(hap, svc, name) {
    const label = name.slice(0, 64);
    svc.displayName = label;
    svc.updateCharacteristic(hap.Characteristic.Name, label);
}
/** Push sanitised values into the service; unknown keys are ignored. */
function applyValues(hap, svc, values) {
    const types = energyHapTypes(hap);
    for (const [key, raw] of Object.entries(values)) {
        svc.updateCharacteristic(types.char(key), (0, sanitize_js_1.sanitize)(definitions_js_1.CHARS[key], raw));
    }
}
/** Remove every service of the given custom type whose subtype is not in `keep`. */
function pruneServices(hap, accessory, key, keep) {
    const ctor = energyHapTypes(hap).service(key);
    for (const svc of servicesOfType(accessory, ctor)) {
        if (!keep.has(svc.subtype ?? ""))
            accessory.removeService(svc);
    }
}
//# sourceMappingURL=hapTypes.js.map