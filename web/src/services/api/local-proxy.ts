import i18n from "@/i18n";
import { normalizeLocalProxyUrl, type AiConfig } from "@/stores/use-config-store";

export type ProxySettings = Pick<AiConfig, "proxyMode" | "proxyUrl" | "upstreamProxyUrl" | "upstreamProxyUsername" | "upstreamProxyPassword">;
export function proxySettings(config: AiConfig): ProxySettings {
    const { proxyMode, proxyUrl, upstreamProxyUrl, upstreamProxyUsername, upstreamProxyPassword } = config;
    return { proxyMode, proxyUrl, upstreamProxyUrl, upstreamProxyUsername, upstreamProxyPassword };
}

export function normalizeProxySettings(settings: ProxySettings): ProxySettings {
    const upstream = settings.proxyMode === "upstream";
    const value = (upstream ? settings.upstreamProxyUrl : settings.proxyUrl).trim();
    if (!value) throw new Error(i18n.t("config.proxy.missingUrl"));
    try {
        const url = new URL(value.includes("://") ? value : `http://${value}`);
        const protocols = upstream ? ["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"] : ["http:", "https:"];
        if (!protocols.includes(url.protocol) || !url.hostname || upstream && url.pathname && url.pathname !== "/" || url.search || url.hash) throw new Error();
        decodeURIComponent(url.username); decodeURIComponent(url.password);
        if (!upstream && (url.username || url.password)) throw new Error();
        if (!upstream) return { ...settings, proxyUrl: url.href.replace(/\/$/, "") };
        const username = settings.upstreamProxyUsername || decodeURIComponent(url.username);
        const password = settings.upstreamProxyPassword || decodeURIComponent(url.password);
        url.username = ""; url.password = "";
        return { ...settings, upstreamProxyUrl: url.href.replace(/\/$/, ""), upstreamProxyUsername: username, upstreamProxyPassword: password };
    } catch { throw new Error(i18n.t("config.proxy.invalidUrl")); }
}

export async function testProxyConnection(settings: ProxySettings) {
    if (settings.proxyMode === "upstream") {
        if (!window.oneYesDesktop) throw new Error(i18n.t("config.proxy.webHint"));
        const result = await window.oneYesDesktop.proxy.test(settings);
        if (result.error || !result.data) throw new Error(result.error || i18n.t("config.proxy.unreachable"));
        return i18n.t("config.proxy.networkAvailable", { status: result.data.status });
    }
    return i18n.t("config.proxy.available", { proxy: await testLocalProxy(settings.proxyUrl) });
}

/** The proxy answers its root path with its own identity payload, which doubles as a reachability check. */
export async function testLocalProxy(proxyUrl: string) {
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base) throw new Error(i18n.t("config.proxy.missingUrl"));
    const response = await fetch(`${base}/`, { cache: "no-store" });
    const data = response.ok ? ((await response.json().catch(() => null)) as { proxy?: string; version?: string } | null) : null;
    if (!data?.proxy) throw new Error(i18n.t("config.proxy.unreachable"));
    return `${data.proxy} v${data.version || "?"}`;
}
