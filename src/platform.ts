import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";
import { EvccClient } from "./api/client.js";
import type { ChargeMode, EvccState, LoadpointState, VehicleState } from "./api/types.js";
import { asLoadpointArray } from "./api/decoders.js";
import { LoadpointAccessory, type LoadpointModeUi } from "./accessories/loadpointAccessory.js";
import { SiteAccessory } from "./accessories/siteAccessory.js";
import { VehiclePresenceAccessory } from "./accessories/vehiclePresenceAccessory.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";

export interface EvccPlatformConfig extends PlatformConfig {
  /** Base URL of the EVCC instance, e.g. `http://evcc.local:7070`. */
  url?: string;
  /** Optional admin password. Required for any settable characteristic. */
  password?: string;
  /** Polling interval in seconds. Default 30. */
  pollInterval?: number;
  /** UI shape for the loadpoint mode/enable surface. Default "outlet". */
  loadpointMode?: LoadpointModeUi;
  /** ChargeMode used when toggling the on/off Outlet to ON. Default "pv". */
  defaultLoadpointMode?: ChargeMode;
  /** Also expose the assigned vehicle's limitSoc as a second blinds. Default false. */
  exposeVehicleLimit?: boolean;
  /** Skip the site-wide telemetry accessory. Default false. */
  hideSite?: boolean;
  /** Skip the per-vehicle occupancy sensors. Default false. */
  hideVehiclePresence?: boolean;
  /** Verbose logging of WS frames and REST traffic. */
  debug?: boolean;
}

export interface EvccPlatformDeps {
  client?: EvccClient;
}

const SITE_ACCESSORY_KEY = "evcc-site";
const LOADPOINT_KEY = (i: number): string => `evcc-loadpoint-${i}`;
const VEHICLE_KEY = (name: string): string => `evcc-vehicle-${name}`;

export class EvccPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private readonly client: EvccClient | null = null;
  private readonly debug: boolean;

  // Adopted accessory wrappers, keyed for fast lookup.
  private siteAccessory: SiteAccessory | null = null;
  private readonly loadpoints = new Map<number, LoadpointAccessory>();
  private readonly vehicles = new Map<string, VehiclePresenceAccessory>();

  /** Whether write commands to EVCC are permitted. Flips to true after a successful login. */
  private writable = false;

  constructor(
    public readonly log: Logging,
    public readonly config: EvccPlatformConfig,
    public readonly api: API,
    deps: EvccPlatformDeps = {},
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.debug = !!config.debug;

    if (!config.url) {
      log.error(
        "No 'url' configured. Add your EVCC base URL (e.g. http://evcc.local:7070) to the Homebridge config — the plugin will stay idle until you do.",
      );
      return;
    }

    this.writable = !!config.password;

    this.client =
      deps.client ??
      new EvccClient({
        baseUrl: config.url,
        password: config.password,
        log,
        pollIntervalMs: config.pollInterval ? config.pollInterval * 1000 : undefined,
      });

    this.client.on("state", (state) => this.onState(state));
    this.client.on("update", (update, touched) => this.onUpdate(update, touched));
    this.client.on("connect", () => log.debug("EVCC websocket connected"));
    this.client.on("disconnect", (reason) =>
      log.debug("EVCC websocket disconnected: %s", reason),
    );

    api.on("didFinishLaunching", () => {
      void this.start();
    });
    api.on("shutdown", () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug("Restoring cached accessory: %s", accessory.displayName);
    this.accessories.push(accessory);
  }

  private async start(): Promise<void> {
    if (!this.client) return;
    this.log.info("Starting EVCC platform (url=%s, writable=%s)", this.config.url, this.writable);
    try {
      await this.client.start();
    } catch (err) {
      this.log.error(
        "Failed to reach EVCC: %s. The plugin will keep retrying in the background.",
        (err as Error).message,
      );
      return;
    }
  }

  private stop(): void {
    if (!this.client) return;
    this.log.info("EVCC platform shutting down.");
    for (const lp of this.loadpoints.values()) lp.dispose();
    for (const v of this.vehicles.values()) v.dispose();
    this.siteAccessory?.dispose();
    this.loadpoints.clear();
    this.vehicles.clear();
    this.siteAccessory = null;
    this.client.stop();
  }

  // ---------------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------------

  private onState(state: EvccState): void {
    this.adoptSite(state);
    this.adoptLoadpoints(state);
    this.adoptVehicles(state);
    this.pruneStale(state);
  }

  private onUpdate(
    update: { key: string; value: unknown },
    touched: ReadonlySet<number>,
  ): void {
    if (this.debug) this.log.debug("EVCC update: %s = %j", update.key, update.value);
    const state = this.client!.getState();

    // Site-level keys: re-render the site card on every change. It's cheap.
    if (this.siteAccessory && !update.key.startsWith("loadpoints.")) {
      this.siteAccessory.applyState(state);
    }

    // Per-loadpoint diff: forward only the trailing key segment.
    if (update.key.startsWith("loadpoints.")) {
      for (const idx of touched) {
        const lp = this.loadpoints.get(idx);
        if (!lp) continue;
        const path = update.key.split(".");
        if (path.length === 2) {
          // Whole loadpoint object replaced.
          const value = state.loadpoints?.[idx];
          if (value) lp.applyState(value);
        } else if (path.length >= 3) {
          lp.applyPartial(path.slice(2).join("."), update.value);
        }
      }
    }

    // Connected / vehicleName changes can flip vehicle-presence sensors.
    if (
      update.key.startsWith("loadpoints.") &&
      (update.key.endsWith(".connected") ||
        update.key.endsWith(".vehicleName") ||
        update.key.split(".").length === 2)
    ) {
      const lps = asLoadpointArray(state.loadpoints);
      for (const v of this.vehicles.values()) v.applyLoadpoints(lps);
    }
  }

  // ---------------------------------------------------------------------------
  // Adoption
  // ---------------------------------------------------------------------------

  private adoptSite(state: EvccState): void {
    if (this.config.hideSite) return;
    const uuid = this.api.hap.uuid.generate(SITE_ACCESSORY_KEY);
    const cached = this.accessories.find((a) => a.UUID === uuid);

    let accessory: PlatformAccessory;
    let isNew = false;
    if (cached) {
      accessory = cached;
      accessory.displayName = state.siteTitle ?? "EVCC";
    } else {
      const Ctor = this.api.platformAccessory;
      accessory = new Ctor(state.siteTitle ?? "EVCC", uuid);
      isNew = true;
    }
    accessory.context.kind = "site";

    if (this.siteAccessory) {
      this.siteAccessory.applyState(state);
    } else {
      this.siteAccessory = new SiteAccessory({
        api: this.api,
        log: this.log,
        client: this.client!,
        accessory,
        state,
        writable: this.writable,
      });
    }

    if (isNew) {
      this.log.info("Adopted EVCC site accessory.");
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private adoptLoadpoints(state: EvccState): void {
    const lps = asLoadpointArray(state.loadpoints);
    for (let idx = 0; idx < lps.length; idx++) {
      this.adoptLoadpoint(idx, lps[idx]);
    }
  }

  private adoptLoadpoint(idx: number, lp: LoadpointState): void {
    const uuid = this.api.hap.uuid.generate(LOADPOINT_KEY(idx));
    const cached = this.accessories.find((a) => a.UUID === uuid);
    const title = lp.title ?? `Loadpoint ${idx + 1}`;

    let accessory: PlatformAccessory;
    let isNew = false;
    if (cached) {
      accessory = cached;
      accessory.displayName = title;
    } else {
      const Ctor = this.api.platformAccessory;
      accessory = new Ctor(title, uuid);
      isNew = true;
    }
    accessory.context.kind = "loadpoint";
    accessory.context.loadpointId = idx;

    const existing = this.loadpoints.get(idx);
    if (existing) {
      existing.applyState(lp);
    } else {
      this.loadpoints.set(
        idx,
        new LoadpointAccessory({
          api: this.api,
          log: this.log,
          client: this.client!,
          accessory,
          loadpointId: idx,
          state: lp,
          config: {
            modeUi: this.config.loadpointMode ?? "outlet",
            defaultMode: this.config.defaultLoadpointMode ?? "pv",
            exposeVehicleLimit: !!this.config.exposeVehicleLimit,
            writable: this.writable,
          },
        }),
      );
    }

    if (isNew) {
      this.log.info("Adopted loadpoint #%d (%s).", idx + 1, title);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private adoptVehicles(state: EvccState): void {
    if (this.config.hideVehiclePresence) return;
    const vehicles = state.vehicles ?? {};
    const lps = asLoadpointArray(state.loadpoints);
    for (const [name, raw] of Object.entries(vehicles)) {
      const vehicle: VehicleState = {
        ...((raw as VehicleState) ?? {}),
        name,
      };
      const uuid = this.api.hap.uuid.generate(VEHICLE_KEY(name));
      const cached = this.accessories.find((a) => a.UUID === uuid);
      const display = vehicle.title ?? name;

      let accessory: PlatformAccessory;
      let isNew = false;
      if (cached) {
        accessory = cached;
        accessory.displayName = display;
      } else {
        const Ctor = this.api.platformAccessory;
        accessory = new Ctor(display, uuid);
        isNew = true;
      }
      accessory.context.kind = "vehicle";
      accessory.context.vehicleName = name;

      const existing = this.vehicles.get(name);
      if (existing) {
        existing.applyVehicleUpdate(vehicle);
        existing.applyLoadpoints(lps);
      } else {
        const v = new VehiclePresenceAccessory({
          api: this.api,
          log: this.log,
          accessory,
          vehicle,
        });
        v.applyLoadpoints(lps);
        this.vehicles.set(name, v);
      }

      if (isNew) {
        this.log.info("Adopted vehicle presence sensor: %s.", display);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }
    }
  }

  /**
   * Drop accessories whose backing entity disappeared from EVCC (e.g. user
   * removed a loadpoint or vehicle from the EVCC config). The site accessory
   * is never pruned automatically.
   */
  private pruneStale(state: EvccState): void {
    const lpCount = asLoadpointArray(state.loadpoints).length;
    const seenVehicleNames = new Set(Object.keys(state.vehicles ?? {}));
    const stale: PlatformAccessory[] = [];
    for (const a of this.accessories) {
      const kind = a.context.kind as string | undefined;
      if (kind === "loadpoint") {
        const idx = a.context.loadpointId as number | undefined;
        if (typeof idx !== "number" || idx >= lpCount) stale.push(a);
      } else if (kind === "vehicle") {
        const name = a.context.vehicleName as string | undefined;
        if (!name || !seenVehicleNames.has(name)) stale.push(a);
      } else if (kind === "site" && this.config.hideSite) {
        stale.push(a);
      }
    }
    if (stale.length === 0) return;
    this.log.info("Removing %d stale EVCC accessory/accessories.", stale.length);
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    for (const a of stale) {
      const idx = this.accessories.indexOf(a);
      if (idx >= 0) this.accessories.splice(idx, 1);
      const kind = a.context.kind as string | undefined;
      if (kind === "loadpoint") this.loadpoints.delete(a.context.loadpointId as number);
      if (kind === "vehicle") this.vehicles.delete(a.context.vehicleName as string);
    }
  }
}
