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
import { parseSessionsConfig } from "./sessions/config.js";
import { SessionsService } from "./sessions/service.js";
import { loadpointSummary } from "./sessions/summary.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { redactUrl, errorText } from "./util/redact.js";

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
  /** Vehicle limitSoc as a second blinds; needs `limitWindowCovering`. Default false. */
  exposeVehicleLimit?: boolean;
  /**
   * Legacy: expose the charge limits as WindowCovering sliders in the Home app.
   * Default false: Apple Home scenes and "close all blinds" would change the
   * charge limit (issue #33). Apps use the custom `Charge Limit` characteristic.
   */
  limitWindowCovering?: boolean;
  /** Skip the site-wide telemetry accessory. Default false. */
  hideSite?: boolean;
  /** Skip the per-vehicle occupancy sensors. Default false. */
  hideVehiclePresence?: boolean;
  /** Skip the custom energy and charging services and control tags (docs/app-contract.md). Default false. */
  hideEnergyCharacteristics?: boolean;
  /**
   * Charging session history: `{ enabled, maxSessions, api: { enabled, bindAddress, port, token } }`.
   * Polls EVCC's session log, keeps it in the Homebridge storage folder and
   * optionally serves it on the LAN (off by default). See the README.
   */
  sessions?: unknown;
  /** Verbose logging of WS frames and REST traffic. */
  debug?: boolean;
}

export interface EvccPlatformDeps {
  client?: EvccClient;
  /** Inject the session history service for tests. */
  sessions?: SessionsService;
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
  private readonly sessions: SessionsService | null = null;

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

    this.sessions = deps.sessions ?? this.createSessions();
    this.sessions?.onUpdated(() => this.applySessionSummaries());

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

  /** The session history service, unless it is switched off or there is no storage folder. */
  private createSessions(): SessionsService | null {
    const { config, errors } = parseSessionsConfig(this.config.sessions);
    for (const e of errors) this.log.error(e);
    const storagePath = (this.api.user as { storagePath?: () => string } | undefined)?.storagePath;
    if (!config.enabled || typeof storagePath !== "function") return null;
    return new SessionsService({
      source: this.client!,
      log: this.log,
      dir: storagePath.call(this.api.user),
      maxSessions: config.maxSessions,
      api: config.api,
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug("Restoring cached accessory: %s", accessory.displayName);
    this.accessories.push(accessory);
  }

  private async start(): Promise<void> {
    if (!this.client) return;
    this.log.info("Starting EVCC platform (url=%s, writable=%s)", redactUrl(this.config.url), this.writable);
    try {
      await this.client.start();
    } catch (err) {
      this.log.error(
        "Failed to reach EVCC: %s. The plugin will keep retrying in the background.",
        errorText(err, this.config.password),
      );
    }
    await this.sessions?.start();
  }

  private stop(): void {
    if (!this.client) return;
    this.log.info("EVCC platform shutting down.");
    this.sessions?.stop();
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
    this.sessions?.noteLoadpoints(asLoadpointArray(state.loadpoints));
    this.applySessionSummaries();
  }

  /** Render each loadpoint's Charging History from the session store (no network). */
  private applySessionSummaries(): void {
    const sessions = this.sessions;
    if (!sessions) return;
    const now = Date.now();
    const updated = sessions.store.lastUpdate === null ? 0 : Math.floor(sessions.store.lastUpdate / 1000);
    for (const lp of this.loadpoints.values()) {
      lp.applySessions(
        loadpointSummary(sessions.store.forLoadpoint(lp.loadpointTitle()), now),
        updated,
      );
    }
  }

  private onUpdate(
    update: { key: string; value: unknown },
    touched: ReadonlySet<number>,
  ): void {
    if (this.debug) this.log.debug("EVCC update: %s = %j", update.key, update.value);
    this.sessions?.noteUpdate(update.key, update.value);
    const state = this.client!.getState();

    // Site-level keys: re-render the site card on every change. It's cheap.
    if (this.siteAccessory && !update.key.startsWith("loadpoints.")) {
      this.siteAccessory.applyState(state);
    } else {
      this.siteAccessory?.touch();
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
      this.siteAccessory.applyState(state, true);
    } else {
      this.siteAccessory = new SiteAccessory({
        api: this.api,
        log: this.log,
        client: this.client!,
        accessory,
        state,
        writable: this.writable,
        energy: !this.config.hideEnergyCharacteristics,
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
            limitWindowCovering: this.config.limitWindowCovering === true,
            writable: this.writable,
            energy: !this.config.hideEnergyCharacteristics,
            sessions: this.sessions !== null,
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
