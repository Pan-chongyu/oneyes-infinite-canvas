import { Alert, Button, Form, Input, Modal, Tag } from "antd";
import { ArrowRight, CheckCircle2, CircleHelp, LogIn, ShieldCheck, Stethoscope, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";
import { useConfigStore } from "@/stores/use-config-store";
import { configureManual, type Platform } from "@/services/api/oneyes-account";

export function OneYesAccountPanel() {
    const { t } = useTranslation();
    const state = useOneYesAccountStore();
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
    return <section className="mb-6 rounded-xl border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <ShieldCheck className="size-6 text-primary" strokeWidth={1.5} />
                <div><div className="text-sm font-semibold">{state.user?.username || state.user?.email || t("config.account.title")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{state.user ? t(`config.account.${state.source === "desktop" ? "shared" : "signedIn"}`) : t("config.account.description")}</div>
                </div>
            </div>
            {state.user ? <Button type="text" size="small" disabled={state.busy} onClick={() => void state.logout()}>{t("config.account.logout")}</Button> : <div className="flex flex-wrap gap-2">
                <Button disabled={state.busy} onClick={() => void state.connect("reuse")}>{t("config.account.reuse")}</Button>
                <Button type="primary" icon={<LogIn className="size-3.5" />} disabled={state.busy} onClick={() => setLoginOpen(true)}>{t("config.account.login")}</Button>
            </div>}
        </div>
        {state.error && <Alert className="mt-4" type="warning" showIcon title={state.error} />}
        <div className="my-4 border-t border-border" />
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 text-xs text-muted-foreground">
                <div><span className="mr-2 font-medium text-foreground">{t("config.account.image")}</span>OpenAI <Tag className="!m-0">SVIP / VIP</Tag></div>
                <div><span className="mr-2 font-medium text-foreground">{t("config.account.text")}</span>OpenAI <Tag className="!m-0">SVIP / VIP</Tag><span className="mx-2">+</span>DeepSeek <Tag className="!m-0">DeepSeek</Tag></div>
                <div><span className="mr-2 font-medium text-foreground">{t("config.account.video")}</span>MiniMax <Tag className="!m-0">Video</Tag></div>
            </div>
            <div className="flex gap-2">
                <Button disabled={state.busy} onClick={showManual}>{t("config.account.manual")}</Button>
                <Button icon={<Stethoscope className="size-3.5" />} loading={state.busy} onClick={() => void state.diagnose()}>{t("config.account.diagnose")}</Button>
                <Button type="primary" disabled={!state.user || state.busy} icon={<WandSparkles className="size-3.5" />} onClick={() => setRepairOpen(true)}>{t("config.account.setup")}</Button>
            </div>
        </div>
        <p className="mb-0 mt-4 text-xs leading-relaxed text-muted-foreground">{t("config.account.keyHint")}</p>
        {!!state.report.length && <div className="mt-4 border-t border-border pt-2" aria-live="polite">
            {state.report.map(item => <div key={item.id} className="flex items-start gap-2 py-2 text-xs">
                {item.status === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" /> : <CircleHelp className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                <div className="min-w-0 flex-1"><span className="font-medium">{item.name}</span><span className="ml-2 text-muted-foreground">{t(`config.account.diagnosis.${item.code}`)}</span>{item.detail && <div className="mt-1 break-words text-muted-foreground">{item.detail}</div>}</div>
                {item.code === "deleted" && state.user && <Button size="small" type="link" disabled={state.busy} onClick={() => setRepairOpen(true)}>{t("config.account.repair")}</Button>}
            </div>)}
        </div>}
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
