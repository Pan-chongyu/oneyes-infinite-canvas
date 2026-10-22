import fetch from "node-fetch";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const protocols = new Set(["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

export function parseProxy(input) {
    const settings = typeof input === "string" ? { url: input } : input;
    const value = settings?.url?.trim();
    if (!value) throw new Error("请填写代理地址");
    try {
        const url = new URL(value.includes("://") ? value : `http://${value}`);
        if (!protocols.has(url.protocol) || !url.hostname || url.pathname !== "" && url.pathname !== "/" || url.search || url.hash) throw new Error();
        if (url.protocol === "socks:") url.protocol = "socks5h:";
        decodeURIComponent(url.username); decodeURIComponent(url.password);
        if (settings.username) url.username = encodeURIComponent(settings.username);
        if (settings.password) url.password = encodeURIComponent(settings.password);
        return url;
    } catch { throw new Error("代理地址无效，请填写 HTTP、HTTPS 或 SOCKS 的主机和端口，不要包含路径"); }
}

export function proxyFailure(error) {
    if (error?.name === "AbortError") return "请求已取消";
    if (/auth|407|credentials|rejected/i.test(error?.message || "")) return "代理认证失败，请检查用户名和密码";
    if (error?.code === "ECONNREFUSED") return "代理连接被拒绝，请确认代理程序已运行、地址和端口正确";
    return "代理请求失败，请检查代理连接、认证和目标服务后重试";
}

/** Explicit agents for every redirect; never fall back to direct access or environment proxies. */
export function createTransport(proxy) {
    const url = proxy ? parseProxy(proxy) : null;
    const http = url ? url.protocol.startsWith("socks") ? new SocksProxyAgent(url) : new HttpProxyAgent(url) : undefined;
    const https = url ? url.protocol.startsWith("socks") ? http : new HttpsProxyAgent(url) : undefined;
    return {
        fetch: (target, options = {}) => fetch(target, { ...options, agent: target => target.protocol === "https:" ? https : http }),
        close() { http?.destroy(); if (https !== http) https?.destroy(); },
    };
}
