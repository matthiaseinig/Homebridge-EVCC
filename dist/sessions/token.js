"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_CONFIGURED_TOKEN_LENGTH = exports.MIN_TOKEN_LENGTH = exports.TOKEN_FILE = void 0;
exports.resolveApiToken = resolveApiToken;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const fsutil_js_1 = require("./fsutil.js");
exports.TOKEN_FILE = "evcc-sessions-token";
exports.MIN_TOKEN_LENGTH = 32;
/** Shortest token accepted from the plugin config. */
exports.MIN_CONFIGURED_TOKEN_LENGTH = 16;
/**
 * The API always needs a token. A configured token wins; otherwise one is read
 * from (or generated into) a 0600 file in the storage folder.
 */
async function resolveApiToken(dir, configured) {
    if (configured)
        return { token: configured, generated: false };
    const file = (0, node_path_1.join)(dir, exports.TOKEN_FILE);
    try {
        const existing = (await (0, promises_1.readFile)(file, "utf8")).trim();
        if (existing.length >= exports.MIN_TOKEN_LENGTH) {
            await (0, promises_1.chmod)(file, fsutil_js_1.FILE_MODE);
            return { token: existing, file, generated: false };
        }
    }
    catch {
        // missing or unreadable: generate below
    }
    const token = (0, node_crypto_1.randomBytes)(32).toString("hex");
    await (0, fsutil_js_1.writeFileAtomic)(file, `${token}\n`);
    return { token, file, generated: true };
}
//# sourceMappingURL=token.js.map