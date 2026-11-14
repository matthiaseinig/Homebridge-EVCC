"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDay = localDay;
exports.bucketKey = bucketKey;
exports.startOfLocalDay = startOfLocalDay;
exports.startOfLocalMonth = startOfLocalMonth;
exports.solarShare = solarShare;
exports.summarize = summarize;
exports.loadpointSummary = loadpointSummary;
const round = (n, decimals) => {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
};
const pad = (n) => String(n).padStart(2, "0");
/** Local `YYYY-MM-DD` of a timestamp. */
function localDay(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function bucketKey(ms, period) {
    const d = new Date(ms);
    return period === "year"
        ? String(d.getFullYear())
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
/** Start of the local day / month containing `ms`. */
function startOfLocalDay(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function startOfLocalMonth(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
/** Energy weighted solar share in percent; 0 when no energy was charged. */
function solarShare(sessions) {
    const total = sessions.reduce((sum, s) => sum + s.chargedKWh, 0);
    if (total <= 0)
        return 0;
    const solar = sessions.reduce((sum, s) => sum + (s.chargedKWh * s.solarPercentage) / 100, 0);
    return (solar / total) * 100;
}
function summarizeBucket(period, sessions) {
    const priced = sessions.filter((s) => s.price !== null);
    const cost = priced.reduce((sum, s) => sum + (s.price ?? 0), 0);
    const pricedKWh = priced.reduce((sum, s) => sum + s.chargedKWh, 0);
    return {
        period,
        sessions: sessions.length,
        chargedKWh: round(sessions.reduce((sum, s) => sum + s.chargedKWh, 0), 3),
        solarPercentage: round(solarShare(sessions), 1),
        cost: priced.length > 0 ? round(cost, 2) : null,
        avgPricePerKWh: priced.length > 0 && pricedKWh > 0 ? round(cost / pricedKWh, 4) : null,
        chargeDurationSeconds: sessions.reduce((sum, s) => sum + s.chargeDurationSeconds, 0),
    };
}
/** Group sessions into month or year buckets by start time, oldest bucket first. */
function summarize(sessions, period) {
    const groups = new Map();
    for (const s of sessions) {
        const key = bucketKey(s.created, period);
        groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key, list]) => summarizeBucket(key, list));
}
function loadpointSummary(sessions, nowMs) {
    const dayStart = startOfLocalDay(nowMs);
    const monthStart = startOfLocalMonth(nowMs);
    const month = sessions.filter((s) => s.created >= monthStart && s.created <= nowMs);
    const today = month.filter((s) => s.created >= dayStart);
    const finished = sessions.filter((s) => s.finished !== null && s.finished <= nowMs);
    const last = finished.reduce((best, s) => (!best || (s.finished ?? 0) > (best.finished ?? 0) ? s : best), undefined);
    return {
        todayKWh: today.reduce((sum, s) => sum + s.chargedKWh, 0),
        monthKWh: month.reduce((sum, s) => sum + s.chargedKWh, 0),
        monthSolarPercentage: solarShare(month),
        lastSessionKWh: last?.chargedKWh ?? 0,
        lastSessionEnd: last?.finished ? Math.floor(last.finished / 1000) : 0,
    };
}
//# sourceMappingURL=summary.js.map