import { Alert, Button, Dropdown, Modal, theme } from "antd";
import { CheckCircle2, ChevronRight, CircleAlert, CircleDashed, GitBranch, Image, LockKeyhole, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Sparkles, Stethoscope, UserRound, Video, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChannelEditorDrawer } from "./channel-editor-drawer";
import { channelIdForPlatform } from "@/services/api/oneyes-account";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";
import { configureModelDefaults, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import { OneYesManualForm } from "./oneyes-connection-forms";

const services = [
    { platform: "openai", name: "OpenAI", purpose: "imageText", group: "SVIP / VIP", icon: Image },
    { platform: "deepseek", name: "DeepSeek", purpose: "text", group: "DeepSeek", icon: MessageSquare },
    { platform: "grok", name: "Grok", purpose: "video", group: "Video", icon: Video },
    { platform: "typesafe", name: "TypeSafe / Jev", purpose: "decision", group: "JEV", icon: GitBranch },
    { platform: "gemini", name: "Gemini", purpose: "imageText", group: "Gemini", icon: Sparkles },
] as const;

export function OneYesAccountPanel() {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const state = useOneYesAccountStore();
    const catalog = useModelCatalogStore();
    const channels = useConfigStore(state => state.config.channels);
    const setupOpen = useConfigStore(state => state.isSetupOpen);
    const [editingChannelId, setEditingChannelId] = useState("");
    const editingChannel = channels.find(channel => channel.id === editingChannelId) || null;
    const [repairOpen, setRepairOpen] = useState(false);
    const [manualOpen, setManualOpen] = useState(false);
    const [manualBusy, setManualBusy] = useState(false);
    const diagnosed = useRef(false);
    useEffect(() => { if (window.oneYesDesktop?.account) void state.restore(); }, [state.restore]);
    useEffect(() => {
        if (state.ready && !state.busy && !setupOpen && channels.some(channel => channel.apiKey.trim()) && !diagnosed.current) {
            diagnosed.current = true;
            if (!state.report.length) void state.diagnose();
        }
    }, [state.ready, state.busy, state.report.length, state.diagnose, setupOpen, channels]);
    const showManual = () => setManualOpen(true);
    const saveChannel = (channel: ModelChannel) => {
        const { config, replaceConfig } = useConfigStore.getState();
        replaceConfig(configureModelDefaults({
            ...config,
            channels: config.channels.map(item => item.id === channel.id ? channel : item),
        }));
        useOneYesAccountStore.setState({ report: [] });
    };

    return <section aria-label={t("config.tabs.channels")} className="@container pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-4">
            <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-muted/60"><UserRound className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" /></div>
                <div className="min-w-0"><h2 className="m-0! text-base font-semibold break-all">{state.user?.username || state.user?.email || t("config.account.title")}</h2>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.user ? t(`config.account.${state.source === "desktop" ? "shared" : "signedIn"}`) : t("config.account.description")}</div>
                </div>
            </div>
            {state.user ? <Button type="text" size="small" disabled={state.busy || manualBusy} onClick={() => void state.logout()}>{t("config.account.logout")}</Button> : <Button type="primary" disabled={state.busy || manualBusy} onClick={() => useConfigStore.getState().openSetup()}>{t("config.onboarding.begin")}</Button>}
        </div>
        {state.error && <Alert className="mt-4" type="warning" showIcon title={state.error} />}
        <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 className="m-0! text-base font-semibold">{t("config.account.services")}</h2>
                <p className="mb-0 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3 shrink-0" aria-hidden="true" />{t("profile.connectionRoute")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button icon={<Stethoscope className="size-3.5" />} disabled={manualBusy} loading={state.busy} onClick={() => void state.diagnose()}>{t("config.account.diagnose")}</Button>
                {state.user && <Button type="primary" disabled={state.busy || manualBusy} icon={<WandSparkles className="size-3.5" />} onClick={() => useConfigStore.getState().openSetup()}>{t("config.onboarding.guide")}</Button>}
                <Dropdown trigger={["click"]} disabled={state.busy || manualBusy} menu={{ items: [{ key: "manual", label: t("config.account.manual"), onClick: showManual }] }}><Button disabled={state.busy || manualBusy} icon={<MoreHorizontal className="size-4" />} aria-label={t("config.onboarding.more")} /></Dropdown>
            </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span role="status">{t(`config.account.${catalog.syncing ? "modelsSyncing" : Object.keys(catalog.errors).length ? "modelsSyncFailed" : catalog.updatedAt ? "modelsSynced" : "modelsAuto"}`)}</span>
            <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} loading={catalog.syncing} disabled={state.busy || manualBusy || !channels.some(channel => channel.apiKey.trim())} onClick={() => void catalog.sync(true)}>{t("config.account.syncModels")}</Button>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-busy={state.busy || catalog.syncing}>
            {services.map(service => {
                const id = channelIdForPlatform(service.platform, channels[0].id);
                const channel = channels.find(item => item.id === id);
                const report = state.report.find(item => item.id === id);
                const result = catalog.errors[id] ? { code: "unavailable", status: "error", detail: catalog.errors[id] } : catalog.checked.includes(id) && (!report || ["modelsChanged", "unavailable"].includes(report.code)) ? { code: "ok", status: "ok" } : report;
                const configured = Boolean(channel?.apiKey.trim());
                const code = result?.code || (configured ? "unchecked" : "unconfigured");
                const healthy = code === "ok";
                const needsAttention = Boolean(result && !healthy && code !== "unconfigured");
                const StatusIcon = healthy ? CheckCircle2 : needsAttention ? CircleAlert : CircleDashed;
                const color = healthy ? token.colorSuccessText : needsAttention ? (result?.status === "error" ? token.colorErrorText : token.colorWarningText) : token.colorTextSecondary;
                const statusColor = healthy || needsAttention ? `color-mix(in srgb, ${color} 65%, ${token.colorTextBase} 35%)` : color;
                const Icon = service.icon;
                return <div key={service.platform} data-platform={service.platform} className="px-4 py-4">
                    <div className="grid items-center gap-x-4 gap-y-2.5 @min-[360px]:grid-cols-[minmax(0,1fr)_auto] @min-[620px]:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                            <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                            <div><h3 className="text-sm font-semibold">{service.name}</h3><div className="mt-1 text-xs text-muted-foreground">{t(`config.account.${service.purpose}`)}</div></div>
                        </div>
                        <div className="min-w-0 pl-8 text-xs @min-[360px]:col-start-1 @min-[360px]:row-start-2 @min-[620px]:col-start-auto @min-[620px]:row-start-auto @min-[620px]:pl-0">
                            <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t(`config.account.${configured ? (channel?.oneYes ? "group" : "manualKey") : "recommendedGroup"}`)}</span>{(!configured || channel?.oneYes) && <span className="font-medium">{channel?.oneYes?.groupName || service.group}</span>}</div>
                            <div className="mt-1.5 text-muted-foreground">{configured ? t("config.channels.modelCount", { count: channel?.models.filter(model => !model.unavailable).length || 0 }) : t("config.account.notConfigured")}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2.5 pl-8 @min-[360px]:col-start-2 @min-[360px]:row-start-1 @min-[360px]:row-span-2 @min-[360px]:flex-col @min-[360px]:items-end @min-[360px]:pl-0 @min-[620px]:col-start-3 @min-[620px]:row-span-1 @min-[620px]:flex-row @min-[620px]:items-center @min-[620px]:gap-4">
                            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: statusColor }} aria-live="polite"><StatusIcon className="size-3.5 shrink-0" aria-hidden="true" />{t(`config.account.status.${code}`)}</span>
                            <Button disabled={state.busy || manualBusy} icon={<Pencil className="size-3.5" />} aria-label={t("config.account.editService", { name: service.name })} onClick={() => channel ? setEditingChannelId(channel.id) : showManual()}>{t(configured ? "config.account.manage" : "config.account.configure")}</Button>
                        </div>
                    </div>
                    {needsAttention && <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-border/60 pt-2.5 pl-8 text-xs leading-relaxed" style={{ color: statusColor }}>
                        {result?.detail ? <details className="group min-w-0 flex-1">
                            <summary style={{ display: "flex" }} className="cursor-pointer list-none items-start gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><ChevronRight className="mt-0.5 size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-open:rotate-90" aria-hidden="true" /><span>{t(`config.account.diagnosis.${code}`)}</span></summary>
                            <p className="mb-0 mt-2 break-words pl-4.5 text-muted-foreground">{result.detail}</p>
                        </details> : <span className="min-w-0 flex-1">{t(`config.account.diagnosis.${code}`)}</span>}
                        {code === "deleted" && state.user && <Button size="small" type="link" disabled={state.busy} onClick={() => setRepairOpen(true)}>{t("config.account.repair")}</Button>}
                    </div>}
                </div>;
            })}
        </div>
        <p className="mb-0 mt-3 text-xs leading-relaxed text-muted-foreground">{t("config.account.keyHint")}</p>
        <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        <Modal open={repairOpen} title={t("config.account.setup")} okText={t("config.account.confirmSetup")} onCancel={() => setRepairOpen(false)} onOk={() => { setRepairOpen(false); void state.configure(); }}>
            <p className="text-sm leading-relaxed">{t("config.account.confirmHint")}</p>
        </Modal>
        <Modal open={manualOpen} title={t("config.account.manual")} footer={null} closable={!manualBusy} keyboard={!manualBusy} mask={{ closable: !manualBusy }} onCancel={() => { if (!manualBusy) setManualOpen(false); }} destroyOnHidden>
            <OneYesManualForm onBusyChange={setManualBusy} onSaved={() => setManualOpen(false)} />
        </Modal>
    </section>;
}
