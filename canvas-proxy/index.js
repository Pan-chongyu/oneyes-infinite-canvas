#!/usr/bin/env node
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { createTransport, proxyFailure } from "./transport.js";

const pkg = createRequire(import.meta.url)("./package.json");
const CORS_HEADERS = {
    "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*",
    "access-control-expose-headers": "*", "access-control-max-age": "86400",
};
const HOP_HEADERS = ["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"];
const SKIP_REQUEST_HEADERS = new Set([...HOP_HEADERS, "host", "content-length", "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]);
const SKIP_RESPONSE_HEADERS = new Set([...HOP_HEADERS, "content-encoding", "content-length"]);

function readArg(args, name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
}

function readTarget(input) {
    // Preserve encoded path/query bytes, including signed media URLs.
    const raw = input.slice(1).replace(/^(https?:)\/*/i, "$1//");
    if (!/^https?:\/\//i.test(raw)) return null;
    const url = new URL(raw);
    if (url.username || url.password) throw new Error("目标地址不能包含凭据");
    return url;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

export function createProxyServer({ proxy, logger = console.log } = {}) {
    const transport = createTransport(proxy);
    const server = createServer(async (req, res) => {
        if (req.method === "OPTIONS") { res.writeHead(204, CORS_HEADERS); res.end(); return; }
        const controller = new AbortController();
        const abort = () => { if (!res.writableFinished) controller.abort(); };
        req.on("aborted", abort); res.on("close", abort);
        const started = Date.now();
        let target;
        try {
            target = readTarget(req.url || "/");
            if (!target) { sendJson(res, 200, { app: "infinite-canvas", proxy: pkg.name, version: pkg.version, upstream: Boolean(proxy), usage: "/<full-target-url>" }); return; }
            const skip = new Set([...SKIP_REQUEST_HEADERS, ...(req.headers.connection || "").toLowerCase().split(/\s*,\s*/)]);
            const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !skip.has(key)));
            const upstream = await transport.fetch(target, { method: req.method, headers, signal: controller.signal, redirect: target.origin === 'https://api.oneyes.ai' ? 'manual' : 'follow',
                ...(!["GET", "HEAD"].includes(req.method) ? { body: req } : {}) });
            if (target.origin === 'https://api.oneyes.ai' && upstream.status >= 300 && upstream.status < 400) {
                upstream.body?.destroy(); sendJson(res, 502, { error: 'OneYes 接口发生重定向，已停止请求以保护 API Key' }); return;
            }
            const responseHeaders = { ...CORS_HEADERS };
            const responseSkip = new Set([...SKIP_RESPONSE_HEADERS, ...(upstream.headers.get("connection") || "").toLowerCase().split(/\s*,\s*/)]);
            upstream.headers.forEach((value, key) => { if (!responseSkip.has(key) && !key.startsWith("access-control-")) responseHeaders[key] = value; });
            res.writeHead(upstream.status, responseHeaders); res.flushHeaders();
            logger(`${req.method} ${target.origin}${target.pathname} -> ${upstream.status} ${((Date.now() - started) / 1000).toFixed(1)}s`);
            if (upstream.body) await pipeline(upstream.body, res); else res.end();
        } catch (error) {
            if (controller.signal.aborted) return;
            const reason = proxyFailure(error);
            logger(`${req.method} ${target ? target.origin + target.pathname : "invalid target"} -> ${reason}`);
            if (res.headersSent) res.destroy(); else sendJson(res, 502, { error: reason });
        } finally { req.off("aborted", abort); res.off("close", abort); }
    });
    server.on("close", () => transport.close());
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`${pkg.name} v${pkg.version}\n\nUsage: node canvas-proxy/index.js [--port 23210] [--host 127.0.0.1] [--proxy socks5h://127.0.0.1:1080]\n\nUpstream: HTTP / HTTPS / SOCKS4 / SOCKS4a / SOCKS5 / SOCKS5h, optional URL-encoded credentials.\nEnvironment: PORT, HOST, CANVAS_UPSTREAM_PROXY. Streams responses without buffering.`);
    } else {
        try {
            const port = Number(readArg(args, "port", process.env.PORT || 23210));
            const host = readArg(args, "host", process.env.HOST || "127.0.0.1");
            createProxyServer({ proxy: readArg(args, "proxy", process.env.CANVAS_UPSTREAM_PROXY) }).listen(port, host, () => {
                console.log(`${pkg.name} v${pkg.version} listening on http://${host}:${port}`);
            });
        } catch (error) { console.error(proxyFailure(error)); process.exitCode = 1; }
    }
}
