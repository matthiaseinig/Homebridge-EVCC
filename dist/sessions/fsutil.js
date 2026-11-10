"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_MODE = void 0;
exports.writeFileAtomic = writeFileAtomic;
exports.backupAside = backupAside;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
exports.FILE_MODE = 0o600;
/**
 * Write a file atomically with owner-only permissions: temp file, fsync, then
 * rename into place. A crash leaves either the old or the new content.
 */
async function writeFileAtomic(path, data) {
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const fh = await (0, promises_1.open)(tmp, "w", exports.FILE_MODE);
    try {
        await fh.writeFile(data, "utf8");
        await fh.sync();
    }
    finally {
        await fh.close();
    }
    await (0, promises_1.chmod)(tmp, exports.FILE_MODE);
    await (0, promises_1.rename)(tmp, path);
}
/** Move an unreadable file aside so it is never overwritten. Returns the backup path. */
async function backupAside(path, nowMs) {
    const target = `${path}.bak-${nowMs}`;
    await (0, promises_1.rename)(path, target);
    return target;
}
//# sourceMappingURL=fsutil.js.map