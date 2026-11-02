const toPosix = (u) => decodeURIComponent(new URL(u).pathname);
module.exports = { URL, URLSearchParams, fileURLToPath: (u) => toPosix(String(u)), pathToFileURL: (p) => new URL('file://' + p), parse: (u) => new URL(u), format: (u) => String(u) };
