import type {
  API,
  Characteristic,
  CharacteristicProps,
  PlatformAccessory,
  Service,
  WithUUID,
} from "homebridge";
import {
  CHARS,
  RETIRED,
  SERVICES,
  type CharDef,
  type CharKey,
  type CharValues,
  type ServiceKey,
} from "./definitions.js";
import { sanitize } from "./sanitize.js";

type Hap = API["hap"];
type CharCtor = WithUUID<new () => Characteristic>;
type ServiceCtor = WithUUID<typeof Service>;

export interface EnergyHapTypes {
  char(key: CharKey): CharCtor;
  props(key: CharKey): CharacteristicProps;
  service(key: ServiceKey): ServiceCtor;
}

const cache = new WeakMap<object, EnergyHapTypes>();
const verifiedServices = new WeakSet<object>();

function toProps(hap: Hap, def: CharDef): CharacteristicProps {
  const props: CharacteristicProps = {
    format: {
      float: hap.Formats.FLOAT,
      uint32: hap.Formats.UINT32,
      bool: hap.Formats.BOOL,
      string: hap.Formats.STRING,
    }[def.format],
    perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
  };
  // Only "%" has a HAP unit. Other units (W, kWh, A, ...) are omitted from the
  // HAP metadata on purpose and documented in the contract instead.
  if (def.unit === "%") props.unit = hap.Units.PERCENTAGE;
  if (def.min !== undefined) props.minValue = def.min;
  if (def.max !== undefined) props.maxValue = def.max;
  if (def.maxLen !== undefined) props.maxLen = def.maxLen;
  return props;
}

function defaultValue(def: CharDef): number | string | boolean {
  return sanitize(def, undefined);
}

/**
 * Build (once per HAP instance) the custom characteristic and service classes.
 * They must extend the HAP classes Homebridge hands us at runtime, so they are
 * created dynamically rather than declared at module level.
 */
export function energyHapTypes(hap: Hap): EnergyHapTypes {
  const cached = cache.get(hap);
  if (cached) return cached;

  const chars = new Map<CharKey, CharCtor>();
  const services = new Map<ServiceKey, ServiceCtor>();
  const propsByKey = new Map<CharKey, CharacteristicProps>();

  const props = (key: CharKey): CharacteristicProps => {
    let p = propsByKey.get(key);
    if (!p) {
      p = toProps(hap, CHARS[key]);
      propsByKey.set(key, p);
    }
    return p;
  };

  const char = (key: CharKey): CharCtor => {
    let ctor = chars.get(key);
    if (!ctor) {
      const def: CharDef = CHARS[key];
      const p = props(key);
      ctor = class extends hap.Characteristic {
        static readonly UUID = def.uuid;
        constructor() {
          super(def.name, def.uuid, { ...p });
          this.value = defaultValue(def);
        }
      };
      chars.set(key, ctor);
    }
    return ctor;
  };

  const service = (key: ServiceKey): ServiceCtor => {
    let ctor = services.get(key);
    if (!ctor) {
      const def = SERVICES[key];
      ctor = class extends hap.Service {
        static readonly UUID = def.uuid;
        constructor(displayName?: string, subtype?: string) {
          super(displayName, def.uuid, subtype);
          for (const k of def.chars) this.addCharacteristic(char(k));
        }
      };
      services.set(key, ctor);
    }
    return ctor;
  };

  const types: EnergyHapTypes = { char, props, service };
  cache.set(hap, types);
  return types;
}

/** All services of `accessory` whose type UUID matches `ctor`. */
export function servicesOfType(accessory: PlatformAccessory, ctor: ServiceCtor): Service[] {
  return (accessory as PlatformAccessory & { services: Service[] }).services.filter(
    (s) => s.UUID === ctor.UUID,
  );
}

/**
 * Find or create a custom service, then make sure it carries every declared
 * characteristic. Services restored from the Homebridge cache are plain HAP
 * services, so characteristics added in a later plugin version are added here
 * and the declared props are re-applied.
 */
export function ensureEnergyService(
  hap: Hap,
  accessory: PlatformAccessory,
  key: ServiceKey,
  name: string,
  subtype: string,
): Service {
  const types = energyHapTypes(hap);
  const ctor = types.service(key);
  const svc =
    servicesOfType(accessory, ctor).find((s) => s.subtype === subtype) ??
    accessory.addService(ctor, name, subtype);
  // The characteristic set only needs checking once per service instance; the
  // accessories re-render on every websocket frame.
  if (!verifiedServices.has(svc)) {
    for (const k of SERVICES[key].chars) ensureCustomCharacteristic(hap, svc, k);
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
export function ensureCustomCharacteristic(hap: Hap, svc: Service, key: CharKey): Characteristic {
  const types = energyHapTypes(hap);
  const c = types.char(key);
  const present = svc.characteristics.some((x) => x.UUID === c.UUID);
  const characteristic = present ? svc.getCharacteristic(c) : svc.addCharacteristic(c);
  characteristic.setProps(types.props(key));
  return characteristic;
}

/** Remove the custom characteristic `key` from `svc` if it is present. */
export function removeCustomCharacteristic(svc: Service, key: CharKey): void {
  const uuid = CHARS[key].uuid;
  const existing = svc.characteristics.find((x) => x.UUID === uuid);
  if (existing) svc.removeCharacteristic(existing);
}

/** Remove services whose type UUID is retired (see RETIRED in definitions.ts). */
export function pruneRetiredServices(accessory: PlatformAccessory): void {
  const services = (accessory as PlatformAccessory & { services: Service[] }).services;
  for (const svc of [...services]) {
    if (svc.UUID in RETIRED.services) accessory.removeService(svc);
  }
}

/** Keep the HAP Name characteristic (and the cached display name) in sync. */
export function setServiceName(hap: Hap, svc: Service, name: string): void {
  const label = name.slice(0, 64);
  (svc as Service & { displayName: string }).displayName = label;
  svc.updateCharacteristic(hap.Characteristic.Name, label);
}

/** Push sanitised values into the service; unknown keys are ignored. */
export function applyValues(hap: Hap, svc: Service, values: CharValues): void {
  const types = energyHapTypes(hap);
  for (const [key, raw] of Object.entries(values) as Array<[CharKey, CharValues[CharKey]]>) {
    svc.updateCharacteristic(types.char(key), sanitize(CHARS[key], raw));
  }
}

/** Remove every service of the given custom type whose subtype is not in `keep`. */
export function pruneServices(
  hap: Hap,
  accessory: PlatformAccessory,
  key: ServiceKey,
  keep: ReadonlySet<string>,
): void {
  const ctor = energyHapTypes(hap).service(key);
  for (const svc of servicesOfType(accessory, ctor)) {
    if (!keep.has(svc.subtype ?? "")) accessory.removeService(svc);
  }
}
