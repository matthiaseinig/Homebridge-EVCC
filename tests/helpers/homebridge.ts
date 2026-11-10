import { vi } from "vitest";
import type { API, Logging, PlatformAccessory } from "homebridge";

export function createMockLogger(): Logging {
  const log = vi.fn() as unknown as Logging;
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  log.debug = vi.fn();
  log.log = vi.fn();
  log.success = vi.fn();
  log.prefix = "test";
  return log;
}

export interface CharacteristicSpy {
  UUID: string;
  displayName?: string;
  props?: Record<string, unknown>;
  value: unknown;
  onSetHandler?: (value: unknown) => void | Promise<void>;
  onGetHandler?: () => unknown;
  updateValue: (v: unknown) => void;
  setProps?: (props: Record<string, unknown>) => CharacteristicSpy;
  onSet: (cb: (value: unknown) => void | Promise<void>) => CharacteristicSpy;
  onGet: (cb: () => unknown) => CharacteristicSpy;
}

/** A characteristic id as the code passes it: a standard name string or a custom constructor. */
export type CharacteristicId = string | { UUID: string; new (): unknown };

function charKey(id: CharacteristicId): string {
  return typeof id === "string" ? id : id.UUID;
}

export class MockService {
  readonly charMap = new Map<string, CharacteristicSpy>();
  UUID: string;
  displayName: string;
  constructor(public type: string, public name: string, public subtype?: string) {
    this.UUID = type;
    this.displayName = name;
  }
  /** Array view, like HAP-NodeJS `Service.characteristics`. */
  get characteristics(): CharacteristicSpy[] {
    return [...this.charMap.values()];
  }
  setCharacteristic(id: CharacteristicId, value: unknown): MockService {
    const c = this.getCharacteristic(id);
    c.value = value;
    return this;
  }
  addCharacteristic(ctor: { UUID: string; new (): unknown }): CharacteristicSpy {
    const instance = new ctor() as { displayName?: string; props?: Record<string, unknown>; value?: unknown };
    const spy = this.getCharacteristic(ctor);
    spy.displayName = instance.displayName;
    spy.props = instance.props;
    spy.value = instance.value;
    return spy;
  }
  getCharacteristic(id: CharacteristicId): CharacteristicSpy {
    const key = charKey(id);
    let c = this.charMap.get(key);
    if (!c) {
      const spy: CharacteristicSpy = {
        UUID: key,
        value: undefined,
        updateValue(v: unknown): void {
          spy.value = v;
        },
        setProps(props): CharacteristicSpy {
          spy.props = { ...(spy.props ?? {}), ...props };
          return spy;
        },
        onSet(cb): CharacteristicSpy {
          spy.onSetHandler = cb;
          return spy;
        },
        onGet(cb): CharacteristicSpy {
          spy.onGetHandler = cb;
          return spy;
        },
      };
      c = spy;
      this.charMap.set(key, c);
    }
    return c;
  }
  removeCharacteristic(c: CharacteristicSpy): void {
    this.charMap.delete(c.UUID);
  }
  updateCharacteristic(id: CharacteristicId, value: unknown): MockService {
    this.getCharacteristic(id).updateValue(value);
    return this;
  }
}

export class MockPlatformAccessory {
  context: Record<string, unknown> = {};
  services: MockService[] = [];
  category?: number;
  constructor(public displayName: string, public UUID: string) {}
  getService(typeOrName: unknown, subtype?: string): MockService | undefined {
    const target =
      typeof typeOrName === "string"
        ? typeOrName
        : (typeOrName as { UUID?: string; name?: string }).UUID ??
          (typeOrName as { name?: string }).name ??
          "Unknown";
    return this.services.find(
      (s) => (s.UUID === target || s.type === target || s.name === target) && s.subtype === subtype,
    );
  }
  addService(type: unknown, name?: string, subtype?: string): MockService {
    if (typeof type === "function") {
      // Custom service class (extends the mock hap.Service).
      const Ctor = type as new (displayName?: string, subtype?: string) => MockService;
      const custom = new Ctor(name, subtype);
      this.services.push(custom);
      return custom;
    }
    const typeName =
      typeof type === "string"
        ? type
        : (type as { name?: string; UUID?: string }).name ??
          (type as { UUID?: string }).UUID ??
          "Unknown";
    const svc = new MockService(typeName, name ?? typeName, subtype);
    this.services.push(svc);
    return svc;
  }
  removeService(svc: MockService): void {
    this.services = this.services.filter((s) => s !== svc);
  }
  on(_event: string, _cb: () => void): this {
    return this;
  }
}

const characteristicNames = [
  "Manufacturer",
  "Model",
  "Name",
  "ConfiguredName",
  "SerialNumber",
  "FirmwareRevision",
  "On",
  "OutletInUse",
  "TargetPosition",
  "CurrentPosition",
  "PositionState",
  "BatteryLevel",
  "ChargingState",
  "StatusLowBattery",
  "CurrentAmbientLightLevel",
  "OccupancyDetected",
  "ContactSensorState",
];

const serviceNames = [
  "AccessoryInformation",
  "Outlet",
  "WindowCovering",
  "Battery",
  "LightSensor",
  "Switch",
  "OccupancySensor",
  "ContactSensor",
];

/** Base class for custom characteristics, mirroring HAP-NodeJS's constructor shape. */
export class MockHapCharacteristic {
  value: unknown = null;
  constructor(
    public displayName: string,
    public UUID: string,
    public props: Record<string, unknown>,
  ) {}
}

/** Base class for custom services, mirroring HAP-NodeJS's constructor shape. */
export class MockHapService extends MockService {
  constructor(displayName: string | undefined, UUID: string, subtype?: string) {
    super(UUID, displayName ?? "", subtype);
  }
}

function buildHapStubs() {
  const Service = class extends MockHapService {} as unknown as Record<
    string,
    { UUID: string; name: string }
  >;
  for (const n of serviceNames) Service[n] = { UUID: n, name: n };
  const Characteristic = class extends MockHapCharacteristic {} as unknown as Record<
    string,
    string
  >;
  for (const n of characteristicNames) Characteristic[n] = n;
  return { Service, Characteristic };
}

/** Mirrors HAP-NodeJS's HapStatusError so tests can assert on the status. */
export class MockHapStatusError extends Error {
  constructor(public hapStatus: number) {
    super(`HAP status ${hapStatus}`);
  }
}

export const MockHAPStatus = {
  INSUFFICIENT_PRIVILEGES: -70401,
  SERVICE_COMMUNICATION_FAILURE: -70402,
  INVALID_VALUE_IN_REQUEST: -70410,
  NOT_ALLOWED_IN_CURRENT_STATE: -70412,
};

const Formats = { FLOAT: "float", UINT32: "uint32", BOOL: "bool", STRING: "string" };
const Perms = { PAIRED_READ: "pr", PAIRED_WRITE: "pw", NOTIFY: "ev" };
const Units = { PERCENTAGE: "percentage" };

export interface MockApi extends API {
  emit(event: string, ...args: unknown[]): void;
  registeredAccessories: MockPlatformAccessory[];
  unregisteredAccessories: MockPlatformAccessory[];
}

export function createMockApi(): MockApi {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const registered: MockPlatformAccessory[] = [];
  const unregistered: MockPlatformAccessory[] = [];
  const { Service, Characteristic } = buildHapStubs();

  const api = {
    hap: {
      Service,
      Characteristic,
      Formats,
      Perms,
      Units,
      HapStatusError: MockHapStatusError,
      HAPStatus: MockHAPStatus,
      uuid: { generate: (id: string) => `uuid:${id}` },
      Categories: { OTHER: 1 },
    },
    on(event: string, cb: (...args: unknown[]) => void): MockApi {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
      return api as MockApi;
    },
    emit(event: string, ...args: unknown[]): void {
      const cbs = listeners.get(event);
      if (cbs) for (const cb of [...cbs]) cb(...args);
    },
    platformAccessory: MockPlatformAccessory as unknown as API["platformAccessory"],
    registerPlatform: vi.fn(),
    registerPlatformAccessories: vi.fn(
      (_p: string, _q: string, accessories: MockPlatformAccessory[]) => {
        registered.push(...accessories);
      },
    ),
    unregisterPlatformAccessories: vi.fn(
      (_p: string, _q: string, accessories: MockPlatformAccessory[]) => {
        unregistered.push(...accessories);
      },
    ),
    updatePlatformAccessories: vi.fn(),
    publishExternalAccessories: vi.fn(),
    version: 2.7,
    serverVersion: "1.8.4",
    user: {} as API["user"],
    versionGreaterOrEqual: () => true,
    registerAccessory: vi.fn(),
    registeredAccessories: registered,
    unregisteredAccessories: unregistered,
  } as unknown as MockApi;

  return api;
}

export function asPlatformAccessory(a: MockPlatformAccessory): PlatformAccessory {
  return a as unknown as PlatformAccessory;
}
