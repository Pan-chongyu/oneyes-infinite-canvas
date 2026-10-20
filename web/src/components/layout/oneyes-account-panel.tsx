import { Alert, Button, Form, Input, Modal, theme } from "antd";
import { ArrowRight, CheckCircle2, ChevronRight, CircleAlert, CircleDashed, Image, KeyRound, LockKeyhole, LogIn, MessageSquare, Pencil, Stethoscope, UserRound, Video, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";
import { useConfigStore } from "@/stores/use-config-store";
import { configureManual, type Platform } from "@/services/api/oneyes-account";

const services = [
    { platform: "openai", name: "OpenAI", purpose: "imageText", group: "SVIP / VIP", icon: Image },
    { platform: "deepseek", name: "DeepSeek", purpose: "text", group: "DeepSeek", icon: MessageSquare },
    { platform: "minimax", name: "MiniMax", purpose: "video", group: "Video", icon: Video },
] as const;

export function OneYesAccountPanel({ onEdit }: { onEdit: (id: string) => void }) {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const state = useOneYesAccountStore();
    const channels = useConfigStore(state => state.config.channels);
    const [loginOpen, setLoginOpen] = useState(false);
    const [form] = Form.useForm();
    const [repairOpen, setRepairOpen] = useState(false);
    const [manualOpen, setManualOpen] = useState(false);
    const [manualBusy, setManualBusy] = useState(false);
    const [manualError, setManualError] = useState("");
    const [manualForm] = Form.useForm();
    const diagnosed = useRef(false);
    useEffect(() => { if (window.oneYesDesktop?.account) void state.restore(); }, [state.restore]);
    useEffect(() => { if (state.user) { setLoginOpen(false); form.resetFields(); } }, [state.user, form]);
    useEffect(() => { if (state.ready && !state.busy && !diagnosed.current) { diagnosed.current = true; void state.diagnose(); } }, [state.ready, state.busy, state.diagnose]);
    const showManual = () => {
        const channels = useConfigStore.getState().config.channels;
        manualForm.setFieldsValue({ openai: channels[0].apiKey, deepseek: channels.find(channel => channel.id === "oneyes-deepseek")?.apiKey || "", minimax: channels.find(channel => channel.id === "oneyes-minimax")?.apiKey || "" });
        setManualError(""); setManualOpen(true);
    };
    return <section aria-label={t("config.tabs.channels")} className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background"><UserRound className="size-5 text-muted-foreground" strokeWidth={1.5} /></div>
                <div className="min-w-0"><div className="break-words text-sm font-semibold">{state.user?.username || state.user?.email || t("config.account.title")}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.user ? t(`config.account.${state.source === "desktop" ? "shared" : "signedIn"}`) : t("config.account.description")}</div>
                </div>
            </div>
            {state.user ? <Button type="text" size="small" disabled={state.busy} onClick={() => void state.logout()}>{t("config.account.logout")}</Button> : <div className="flex flex-wrap gap-2">
                <Button disabled={state.busy} onClick={() => void state.connect("reuse")}>{t("config.account.reuse")}</Button>
                <Button type="primary" icon={<LogIn className="size-3.5" />} disabled={state.busy} onClick={() => setLoginOpen(true)}>{t("config.account.login")}</Button>
            </div>}
        </div>
        {state.error && <Alert className="mt-4" type="warning" showIcon title={state.error} />}
        <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 className="text-sm font-semibold">{t("config.account.services")}</h2>
                <p className="mb-0 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3" aria-hidden="true" />api.oneyes.ai</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button type="text" icon={<KeyRound className="size-3.5" />} disabled={state.busy || manualBusy} onClick={showManual}>{t("config.account.manual")}</Button>
                <Button icon={<Stethoscope className="size-3.5" />} loading={state.busy} onClick={() => void state.diagnose()}>{t("config.account.diagnose")}</Button>
                <Button type="primary" disabled={!state.user || state.busy} icon={<WandSparkles className="size-3.5" />} onClick={() => setRepairOpen(true)}>{t("config.account.setup")}</Button>
            </div>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border" aria-busy={state.busy}>
            {services.map(service => {
                const id = service.platform === "openai" ? channels[0].id : `oneyes-${service.platform}`;
                const channel = channels.find(item => item.id === id);
                const result = state.report.find(item => item.id === id);
                const configured = Boolean(channel?.apiKey.trim());
                const code = result?.code || (configured ? "unchecked" : "unconfigured");
                const healthy = code === "ok";
                const needsAttention = Boolean(result && !healthy && code !== "unconfigured");
                const StatusIcon = healthy ? CheckCircle2 : needsAttention ? CircleAlert : CircleDashed;
                const color = healthy ? token.colorSuccessText : needsAttention ? (result?.status === "error" ? token.colorErrorText : token.colorWarningText) : token.colorTextSecondary;
                const statusColor = healthy || needsAttention ? `color-mix(in srgb, ${color} 65%, ${token.colorTextBase} 35%)` : color;
                const Icon = service.icon;
                return <div key={service.platform} data-platform={service.platform} className="px-4 py-4">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                            <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                            <div><h3 className="text-sm font-semibold">{service.name}</h3><div className="mt-1 text-xs text-muted-foreground">{t(`config.account.${service.purpose}`)}</div></div>
                        </div>
                        <div className="col-start-1 row-start-2 pl-8 text-xs sm:col-start-auto sm:row-start-auto sm:pl-0">
                            <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">{t(`config.account.${configured ? (channel?.oneYes ? "group" : "manualKey") : "recommendedGroup"}`)}</span>{(!configured || channel?.oneYes) && <span className="font-medium">{channel?.oneYes?.groupName || service.group}</span>}</div>
                            <div className="mt-1.5 text-muted-foreground">{configured ? t("config.channels.modelCount", { count: channel?.models.length || 0 }) : t("config.account.notConfigured")}</div>
                        </div>
                        <div className="col-start-2 row-start-1 row-span-2 flex flex-col items-end gap-2.5 sm:col-start-3 sm:row-span-1 sm:flex-row sm:items-center sm:gap-4">
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: statusColor }} aria-live="polite"><StatusIcon className="size-3.5" aria-hidden="true" />{t(`config.account.status.${code}`)}</span>
                            <Button disabled={state.busy} icon={<Pencil className="size-3.5" />} aria-label={t("config.account.editService", { name: service.name })} onClick={() => channel ? onEdit(channel.id) : showManual()}>{t(configured ? "common.edit" : "config.account.configure")}</Button>
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
        <Modal open={repairOpen} title={t("config.account.setup")} okText={t("config.account.confirmSetup")} onCancel={() => setRepairOpen(false)} onOk={() => { setRepairOpen(false); void state.configure(); }}>
            <p className="text-sm leading-relaxed">{t("config.account.confirmHint")}</p>
        </Modal>
        <Modal open={loginOpen} title={t("config.account.login")} footer={null} onCancel={() => { setLoginOpen(false); form.resetFields(); }} destroyOnHidden>
            <Form form={form} layout="vertical" onFinish={async values => { await state.connect(state.requires_2fa ? "login_2fa" : "login", values); form.setFieldValue("password", ""); }}>
                {state.requires_2fa ? <Form.Item name="code" label={t("config.account.code")} rules={[{ required: true }]}><Input autoComplete="one-time-code" inputMode="numeric" autoFocus /></Form.Item> : <>
                    <Form.Item name="email" label={t("config.account.email")} rules={[{ required: true, type: "email" }]}><Input autoComplete="username" autoFocus /></Form.Item>
                    <Form.Item name="password" label={t("config.account.password")} rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
                </>}
                {state.error && <Alert className="mb-4" type="error" showIcon title={state.error} />}
                <Button type="primary" htmlType="submit" block loading={state.busy} icon={<ArrowRight className="size-4" />}>{t(state.requires_2fa ? "config.account.verify" : "config.account.login")}</Button>
                {state.requires_2fa && <Button block type="text" disabled={state.busy} onClick={() => { useOneYesAccountStore.setState({ requires_2fa: false, error: "" }); form.resetFields(); }}>{t("config.account.backToLogin")}</Button>}
                <div className="mt-3 flex justify-between text-xs"><a href="https://api.oneyes.ai/register" target="_blank" rel="noreferrer">{t("config.account.register")}</a><a href="https://api.oneyes.ai/forgot-password" target="_blank" rel="noreferrer">{t("config.account.forgot")}</a></div>
            </Form>
        </Modal>
        <Modal open={manualOpen} title={t("config.account.manual")} footer={null} onCancel={() => { if (!manualBusy) { setManualOpen(false); manualForm.resetFields(); } }} destroyOnHidden>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("config.account.manualHint")}</p>
            <Form form={manualForm} layout="vertical" onFinish={async (values: Record<Platform, string>) => {
                setManualBusy(true); setManualError("");
                try {
                    useConfigStore.getState().replaceConfig(await configureManual(useConfigStore.getState().config, values));
                    setManualOpen(false); manualForm.resetFields(); void state.diagnose();
                } catch (error) { setManualError(error instanceof Error ? error.message : String(error)); }
                finally { setManualBusy(false); }
            }}>
                <Form.Item name="openai" label="OpenAI · SVIP / VIP"><Input.Password autoComplete="off" placeholder="sk-..." /></Form.Item>
                <Form.Item name="deepseek" label="DeepSeek · DeepSeek"><Input.Password autoComplete="off" placeholder="sk-..." /></Form.Item>
                <Form.Item name="minimax" label="MiniMax · Video"><Input.Password autoComplete="off" placeholder="sk-..." /></Form.Item>
                {manualError && <Alert className="mb-4" type="error" title={manualError} />}
                <Button htmlType="submit" type="primary" block loading={manualBusy}>{t("config.account.saveManual")}</Button>
            </Form>
        </Modal>
    </section>;
}
