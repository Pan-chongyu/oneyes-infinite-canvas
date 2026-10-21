import { Alert, Button, Form, Input } from "antd";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { configureManual, type Platform } from "@/services/api/oneyes-account";
import { GROK_VIDEO_CHANNEL_ID, useConfigStore } from "@/stores/use-config-store";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";

export function OneYesLoginForm() {
    const { t } = useTranslation();
    const state = useOneYesAccountStore();
    const [form] = Form.useForm();
    return <Form form={form} layout="vertical" requiredMark={false} onFinish={async values => {
        await state.connect(state.requires_2fa ? "login_2fa" : "login", values);
        form.resetFields(["password", "code"]);
    }}>
        {state.requires_2fa ? <Form.Item name="code" label={t("config.account.code")} rules={[{ required: true }]}><Input autoComplete="one-time-code" inputMode="numeric" autoFocus disabled={state.busy} /></Form.Item> : <>
            <Form.Item name="email" label={t("config.account.email")} rules={[{ required: true, type: "email" }]}><Input autoComplete="username" autoFocus disabled={state.busy} /></Form.Item>
            <Form.Item name="password" label={t("config.account.password")} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={state.busy} /></Form.Item>
        </>}
        {state.error && <Alert className="mb-4" type="error" showIcon title={state.error} />}
        <Button type="primary" htmlType="submit" block loading={state.busy} icon={<ArrowRight className="size-4" />}>{t(state.requires_2fa ? "config.account.verify" : "config.account.login")}</Button>
        {state.requires_2fa && <Button block type="text" disabled={state.busy} onClick={() => { useOneYesAccountStore.setState({ requires_2fa: false, error: "" }); form.resetFields(); }}>{t("config.account.backToLogin")}</Button>}
        <div className="mt-4 flex justify-between text-xs"><a href="https://api.oneyes.ai/register" target="_blank" rel="noreferrer">{t("config.account.register")}</a><a href="https://api.oneyes.ai/forgot-password" target="_blank" rel="noreferrer">{t("config.account.forgot")}</a></div>
    </Form>;
}

export function OneYesManualForm({ onSaved, onBusyChange }: { onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const channels = useConfigStore.getState().config.channels;
    const grokChannel = channels.find(channel => channel.id === GROK_VIDEO_CHANNEL_ID);
    return <Form layout="vertical" requiredMark={false} initialValues={{ openai: channels[0].apiKey, deepseek: channels.find(channel => channel.id === "oneyes-deepseek")?.apiKey || "", grok: grokChannel?.oneYes?.platform === "minimax" ? "" : grokChannel?.apiKey || "" }} onFinish={async (values: Record<Platform, string>) => {
        if (!Object.values(values).some(value => value?.trim())) { setError(t("config.onboarding.needKey")); return; }
        setBusy(true); onBusyChange(true); setError("");
        try {
            useConfigStore.getState().replaceConfig(await configureManual(useConfigStore.getState().config, values));
            await useOneYesAccountStore.getState().diagnose();
            onSaved();
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); onBusyChange(false); }
    }}>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t("config.account.manualHint")}</p>
        <Form.Item name="openai" label="OpenAI · SVIP / VIP"><Input.Password disabled={busy} autoComplete="off" placeholder="sk-..." /></Form.Item>
        <Form.Item name="deepseek" label="DeepSeek · DeepSeek"><Input.Password disabled={busy} autoComplete="off" placeholder="sk-..." /></Form.Item>
        <Form.Item name="grok" label="Grok · Video"><Input.Password disabled={busy} autoComplete="off" placeholder="sk-..." /></Form.Item>
        {error && <Alert className="mb-4" type="error" showIcon title={error} />}
        <Button htmlType="submit" type="primary" block loading={busy}>{t("config.account.saveManual")}</Button>
    </Form>;
}
