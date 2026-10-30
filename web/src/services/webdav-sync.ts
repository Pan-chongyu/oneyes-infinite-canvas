import i18n from "@/i18n";
import { withLocalProxy, type WebdavSyncConfig } from "@/stores/use-config-store";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120000;
// A sync/test owns a fresh config snapshot. Deduplicate MKCOL only within it.
const directories = new WeakMap<WebdavSyncConfig, Map<string, Promise<void>>>();
const webdavText = (key: string, options?: Record<string, unknown>) => i18n.t(`config.webdav.errors.${key}`, options);
type WriteCondition = { ifMatch?: string; ifNoneMatch?: string; ifUnmodifiedSince?: string };

async function inspectWebdavResource(config: WebdavSyncConfig, path: string, collection = false, directory = config.directory) {
    const target = { ...config, directory };
    return webdavFetch(target, path, {
        method: "PROPFIND", headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
        body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    }, async response => {
        if (response.status === 404) { await response.body?.cancel(); return false; }
        if (!response.ok) await throwWebdavError(response, webdavText("downloadFailed"));
        const text = await response.text();
        if (/<!DOCTYPE/i.test(text)) throw new Error(webdavText("invalidDavResponse"));
        const xml = new DOMParser().parseFromString(text, "application/xml");
        if (xml.getElementsByTagName("parsererror").length || xml.documentElement?.namespaceURI !== "DAV:" || xml.documentElement.localName !== "multistatus") throw new Error(webdavText("invalidDavResponse"));
        const expected = new URL(buildWebdavUrl(target, path));
        const pathname = (url: URL) => decodeURI(url.pathname).replace(/\/$/, "");
        for (const entry of Array.from(xml.getElementsByTagNameNS("DAV:", "response"))) {
            const href = entry.getElementsByTagNameNS("DAV:", "href")[0]?.textContent?.trim();
            if (!href) continue;
            let resource: URL;
            try { resource = new URL(href, expected); } catch { continue; }
            if (resource.origin !== expected.origin || resource.search || resource.hash || resource.username || resource.password || pathname(resource) !== pathname(expected)) continue;
            const status = Array.from(entry.childNodes).find(child => child.nodeType === 1 && (child as Element).namespaceURI === "DAV:" && (child as Element).localName === "status")?.textContent?.trim();
            const code = /^HTTP\/\S+ (\d{3})(?:\s|$)/.exec(status || "")?.[1];
            if (code === "404") return false;
            if (code && !code.startsWith("2")) await throwWebdavError(new Response(null, { status: Number(code) }), webdavText("downloadFailed"));
            for (const propstat of Array.from(entry.getElementsByTagNameNS("DAV:", "propstat"))) {
                if (!/^HTTP\/\S+ 2\d\d(?:\s|$)/.test(propstat.getElementsByTagNameNS("DAV:", "status")[0]?.textContent?.trim() || "")) continue;
                const type = propstat.getElementsByTagNameNS("DAV:", "resourcetype")[0];
                if (type) {
                    if (collection && !type.getElementsByTagNameNS("DAV:", "collection").length) throw new Error(webdavText("notCollection"));
                    return true;
                }
            }
        }
        throw new Error(webdavText("invalidDavResponse"));
    });
}

export async function testWebdavConnection(config: WebdavSyncConfig) {
    config = { ...config };
    await ensureWebdavDirectoryPath(config, config.directory);
    if (!await inspectWebdavResource(config, "", true)) throw new Error(webdavText("pathMissing"));
}

export async function downloadWebdavSyncFile(config: WebdavSyncConfig) {
    return downloadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME);
}

export async function readWebdavFile(config: WebdavSyncConfig, path: string) {
    return webdavFetch(config, path, { method: "GET" }, async response => {
        if (response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok) await throwWebdavError(response, webdavText("downloadFailed"));
        const blob = await response.blob();
        if (!blob.size) throw new Error(webdavText("emptyDownload"));
        return { blob, etag: response.headers.get("etag") || undefined, lastModified: response.headers.get("last-modified") || undefined };
    });
}

export async function downloadWebdavFile(config: WebdavSyncConfig, path: string) {
    return (await readWebdavFile(config, path))?.blob ?? null;
}

export async function webdavFileExists(config: WebdavSyncConfig, path: string) {
    return webdavFetch(config, path, { method: "HEAD" }, async response => {
        if (response.status === 404) { await response.body?.cancel(); return false; }
        if ([405, 501].includes(response.status)) {
            await response.body?.cancel();
            return inspectWebdavResource(config, path);
        }
        if (!response.ok) await throwWebdavError(response, webdavText("downloadFailed"));
        await response.body?.cancel();
        return true;
    });
}

export async function uploadWebdavSyncFile(config: WebdavSyncConfig, file: Blob) {
    return uploadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME, file, "application/json");
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream", condition: WriteCondition = {}) {
    if (!file.size) throw new Error(webdavText("emptyUpload"));
    await ensureWebdavDirectoryPath(config, [...pathParts(config.directory), ...pathParts(path).slice(0, -1)].join("/"));
    const headers = new Headers({ "Content-Type": contentType });
    if (condition.ifMatch) headers.set("If-Match", condition.ifMatch);
    if (condition.ifNoneMatch) headers.set("If-None-Match", condition.ifNoneMatch);
    if (condition.ifUnmodifiedSince) headers.set("If-Unmodified-Since", condition.ifUnmodifiedSince);
    await webdavFetch(config, path, { method: "PUT", headers, body: file }, async response => {
        if (!response.ok) await throwWebdavError(response, webdavText("uploadFailed"));
        await response.body?.cancel();
    });
}

async function ensureWebdavDirectoryPath(config: WebdavSyncConfig, directory: string) {
    buildWebdavUrl(config, "");
    let cache = directories.get(config);
    if (!cache) { cache = new Map(); directories.set(config, cache); }
    const parts = pathParts(directory);
    for (let index = 0; index < parts.length; index++) {
        const path = parts.slice(0, index + 1).join("/");
        let pending = cache.get(path);
        if (!pending) {
            pending = webdavFetch({ ...config, directory: "" }, path + "/", { method: "MKCOL" }, async response => {
                if (response.ok) { await response.body?.cancel(); return; }
                if ([403, 405, 409, 423].includes(response.status)) {
                    await response.body?.cancel();
                    if (await inspectWebdavResource(config, path + "/", true, "")) return;
                    throw new Error(webdavText(response.status === 403 ? "permissionDenied" : "pathMissing"));
                }
                await throwWebdavError(response, webdavText("directoryFailed"));
            });
            cache.set(path, pending);
        }
        try { await pending; } catch (error) { cache.delete(path); throw error; }
    }
}

async function webdavFetch<T>(config: WebdavSyncConfig, path: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    const target = buildWebdavUrl(config, path);
    const headers = new Headers(init.headers);
    if (config.username || config.password) headers.set("Authorization", `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        const url = window.oneYesDesktop ? `oneyes-canvas://app/webdav?url=${encodeURIComponent(target)}` : withLocalProxy(target);
        const response = await fetch(url, { ...init, headers, signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" });
        return await consume(response);
    } catch (error) {
        if (controller.signal.aborted) throw new Error(webdavText("requestTimeout"));
        if (error instanceof TypeError) throw new Error(webdavText("connectionFailed"));
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

export function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
    if (!config.url.trim()) throw new Error(webdavText("urlRequired"));
    let url: URL;
    try { url = new URL(config.url.trim()); } catch { throw new Error(webdavText("invalidUrl")); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(webdavText("invalidUrl"));
    const parts = [...pathParts(config.directory), ...pathParts(path)];
    url.pathname = url.pathname.replace(/\/+$/, "") + "/" + parts.map(encodeURIComponent).join("/");
    // Collections need their trailing slash on Nextcloud, NAS and Apache DAV.
    if ((!path || path.endsWith("/")) && !url.pathname.endsWith("/")) url.pathname += "/";
    return url.href;
}

function pathParts(path: string) {
    const parts = path.trim().split("/").filter(Boolean);
    if (parts.some(part => part === "." || part === ".." || /[\\\x00-\x1f]/.test(part) || /%(?:2e|2f|5c)/i.test(part))) throw new Error(webdavText("invalidPath"));
    return parts;
}

async function throwWebdavError(response: Response, fallback: string): Promise<never> {
    if ([401, 403, 404, 409, 412, 423, 507].includes(response.status)) {
        await response.body?.cancel();
        const key = ({ 401: "authenticationFailed", 403: "permissionDenied", 404: "pathMissing", 409: "pathMissing", 412: "conflict", 423: "locked", 507: "quota" } as Record<number, string>)[response.status];
        throw new Error(webdavText(key));
    }
    // Do not echo DAV HTML error pages, which can contain account details.
    const detail = await response.json().then(value => value?.error?.message).catch(() => "");
    if (typeof detail === "string" && /^(WebDAV|代理|请填写代理)/.test(detail)) throw new Error(detail);
    throw new Error(webdavText("responseFailed", { fallback, status: response.status, detail: "" }));
}

function encodeBasicAuth(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
}
