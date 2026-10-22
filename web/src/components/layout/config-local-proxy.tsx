import { App, Button, Form, Input, Select, Switch } from "antd";
import { Copy, Network, Wifi } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { normalizeProxySettings, proxySettings, testProxyConnection } from "@/services/api/local-proxy";
import { DEFAULT_LOCAL_PROXY_URL, LOCAL_PROXY_PACKAGE, normalizeLocalProxyUrl, useConfigStore } from "@/stores/use-config-store";

export function ConfigLocalProxy() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const config = useConfigStore(state => state.config);
    const desktop = Boolean(window.oneYesDesktop);
    const [draft, setDraft] = useState(() => ({ ...proxySettings(config), proxyMode: desktop ? config.proxyMode : "forwarder" as const }));
    const [busy, setBusy] = useState<"save" | "test" | null>(null);
    const upstream = desktop && draft.proxyMode === "upstream";
    const change = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
    let command = `npx ${LOCAL_PROXY_PACKAGE}@latest`;
    try { const port = new URL(normalizeLocalProxyUrl(draft.proxyUrl)).port; if (port && port !== new URL(DEFAULT_LOCAL_PROXY_URL).port) command += ` --port ${port}`; } catch { /* Incomplete address while editing. */ }

    async function save(enabled = true) {
        setBusy("save");
        try {
            const settings = enabled ? normalizeProxySettings(draft) : draft;
            await useConfigStore.setState(state => ({ config: { ...state.config, ...settings, proxyEnabled: enabled } }));
            setDraft(settings);
            message.success(t(enabled ? "config.proxy.saved" : "config.proxy.disabled"));
        } catch (error) { message.error(error instanceof Error ? error.message : t("config.proxy.saveFailed")); }
        finally { setBusy(null); }
    }

    async function test() {
        setBusy("test");
        try { message.success(await testProxyConnection(normalizeProxySettings(draft))); }
        catch (error) { message.error(error instanceof Error ? error.message : t("config.proxy.unreachable")); }
        finally { setBusy(null); }
    }

    return (
        <Form layout="vertical" requiredMark={false} onFinish={() => void save()}>
            <section className="rounded-lg border border-border p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold"><Network className="size-4" />{t("config.proxy.title")}</div>
                        <p className="mt-1 text-xs text-muted-foreground">{t(desktop ? "config.proxy.desktopDescription" : "config.proxy.description")}</p>
                    </div>
                    <Switch aria-label={t("config.proxy.title")} checked={config.proxyEnabled} loading={busy === "save"} disabled={busy !== null} onChange={enabled => void save(enabled)} />
                </div>
                {desktop && <Form.Item label={t("config.proxy.mode")}>
                    <Select value={draft.proxyMode} disabled={busy !== null} onChange={value => change("proxyMode", value)} options={[
                        { value: "upstream", label: t("config.proxy.upstream") },
                        { value: "forwarder", label: t("config.proxy.forwarder") },
                    ]} />
                </Form.Item>}
                {upstream ? <>
                    <Form.Item label={t("config.proxy.address")} extra={t("config.proxy.protocolHint")}>
                        <Input autoComplete="off" value={draft.upstreamProxyUrl} placeholder="socks5://127.0.0.1:1080" onChange={event => change("upstreamProxyUrl", event.target.value)} />
                    </Form.Item>
                    <div className="grid gap-x-3 sm:grid-cols-2">
                        <Form.Item label={t("config.proxy.username")}><Input autoComplete="off" value={draft.upstreamProxyUsername} onChange={event => change("upstreamProxyUsername", event.target.value)} /></Form.Item>
                        <Form.Item label={t("config.proxy.password")}><Input.Password autoComplete="new-password" value={draft.upstreamProxyPassword} onChange={event => change("upstreamProxyPassword", event.target.value)} /></Form.Item>
                    </div>
                </> : <>
                    <div className="mb-3 rounded-md bg-muted/50 px-3 py-2">
                        <p className="mb-1 text-xs text-muted-foreground">{t("config.proxy.startHint")}</p>
                        <div className="flex items-center justify-between gap-3">
                            <code className="min-w-0 truncate text-xs">{command}</code>
                            <Button size="small" type="text" aria-label={t("config.proxy.copyCommand")} icon={<Copy className="size-3.5" />} onClick={() => copyText(command)} />
                        </div>
                    </div>
                    <Form.Item label={t("config.proxy.address")} extra={t("config.proxy.addressDescription")}>
                        <Input value={draft.proxyUrl} placeholder={DEFAULT_LOCAL_PROXY_URL} onChange={event => change("proxyUrl", event.target.value)} />
                    </Form.Item>
                    <p className="mb-3 text-xs text-muted-foreground">{t("config.proxy.webHint")}</p>
                </>}
                <div className="flex flex-wrap gap-2">
                    <Button type="primary" htmlType="submit" loading={busy === "save"} disabled={busy !== null}>{t("config.proxy.saveEnable")}</Button>
                    <Button icon={<Wifi className="size-4" />} loading={busy === "test"} disabled={busy !== null} onClick={() => void test()}>{t("config.proxy.test")}</Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{t("config.proxy.channelHint")}</p>
            </section>
        </Form>
    );
}
