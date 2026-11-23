import { Alert, Button, Modal, Steps, theme } from "antd";
import { CheckCircle2, CircleAlert, CircleDashed, GitBranch, Image, LoaderCircle, MessageSquare, SlidersHorizontal, Video, WandSparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GROK_VIDEO_CHANNEL_ID, hasConfiguredModels, useConfigStore } from "@/stores/use-config-store";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";
import { getVerifiedSetupIds, shouldOpenSetup } from "@/stores/oneyes-setup";
import { OneYesLoginForm, OneYesManualForm } from "./oneyes-connection-forms";

export function OneYesSetupDialog() {
    const open = useConfigStore(state => state.isSetupOpen);
    const accountReady = useOneYesAccountStore(state => state.ready);
    const considered = useRef(false);
    useEffect(() => {
        if (considered.current || (window.oneYesDesktop?.account && !accountReady)) return;
        considered.current = true;
        const state = useConfigStore.getState();
        if (shouldOpenSetup(state)) state.openSetup();
    }, [accountReady]);
    return open ? <SetupContent /> : null;
}

function SetupContent() {
    const { t } = useTranslation();
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const account = useOneYesAccountStore();
    const config = useConfigStore(state => state.config);
    const setupMode = useConfigStore(state => state.setupMode);
    const setupStatus = useConfigStore(state => state.setupStatus);
    const desktop = Boolean(window.oneYesDesktop?.account);
    const choosing = desktop && !setupMode && setupStatus === "pending" && !hasConfiguredModels(config);
    const beginner = setupMode === "beginner";
    const [manual, setManual] = useState(!desktop);
    const [manualBusy, setManualBusy] = useState(false);
    const [result, setResult] = useState(false);
    const attemptedAccount = useRef<number | null>(null);
    const busy = account.busy || manualBusy;
    const verified = getVerifiedSetupIds(config, account.report, account.error);
    const step = result && verified.length ? 2 : account.user || manual ? 1 : 0;
    const services = [
        { id: config.channels[0].id, name: "OpenAI", purpose: "imageText", group: "SVIP / VIP", icon: Image },
        { id: "oneyes-deepseek", name: "DeepSeek", purpose: "text", group: "DeepSeek", icon: MessageSquare },
        { id: GROK_VIDEO_CHANNEL_ID, name: "Grok", purpose: "video", group: "Video", icon: Video },
        { id: "oneyes-typesafe", name: "TypeSafe / Jev", purpose: "decision", group: "JEV", icon: GitBranch },
    ];
    const close = () => { if (!busy) useConfigStore.getState().closeSetup(); };
    const configure = useCallback(async () => {
        setResult(false);
        await useOneYesAccountStore.getState().configure();
        setResult(true);
    }, []);
    useEffect(() => {
        if (!beginner || manual || result || !account.ready || account.busy || account.requires_2fa || !account.user || attemptedAccount.current === account.user.id) return;
        // One automatic attempt per account/opening; failures require an explicit retry.
        attemptedAccount.current = account.user.id;
        void configure();
    }, [beginner, manual, result, account.ready, account.busy, account.requires_2fa, account.user, configure]);
    if (choosing) return <Modal open centered width={580} title={t("config.onboarding.title")} footer={null} onCancel={close} styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto" } }}>
        <div className="pb-1 pt-5">
            <h2 className="mb-2 text-2xl font-semibold tracking-tight">{t("config.onboarding.chooseTitle")}</h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t("config.onboarding.chooseHint")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["beginner", "expert"] as const).map(mode => {
                    const Icon = mode === "beginner" ? WandSparkles : SlidersHorizontal;
                    return <button key={mode} type="button" data-setup-mode={mode} onClick={() => useConfigStore.getState().setSetupMode(mode)} className="group flex min-h-40 flex-col items-start rounded-xl border border-border p-5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        <Icon className="mb-4 size-5 text-muted-foreground" />
                        <span className="text-lg font-semibold">{t(`config.onboarding.${mode}`)}</span>
                        <span className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`config.onboarding.${mode}Hint`)}</span>
                    </button>;
                })}
            </div>
            <p className="mb-0 mt-4 text-xs leading-relaxed text-muted-foreground">{t("config.onboarding.choiceNote")}</p>
        </div>
    </Modal>;
    return <Modal open centered width={580} title={t("config.onboarding.title")} footer={null} onCancel={close} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto" } }}>
        <div className="mb-6 mt-5"><Steps size="small" responsive={false} current={step} items={["login", "configure", "done"].map(key => ({ title: t(`config.onboarding.steps.${key}`) }))} /></div>
        <motion.div key={`${step}-${manual}`} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
            <h2 className="mb-2 text-xl font-semibold tracking-tight">{t(`config.onboarding.${step === 0 ? "loginTitle" : result ? (verified.length ? "doneTitle" : "failedTitle") : "configureTitle"}`)}</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t(`config.onboarding.${step === 0 ? (beginner ? "beginnerLoginHint" : "loginHint") : result ? (verified.length ? (verified.length === services.length ? "doneHint" : "partialHint") : "failedHint") : manual ? "manualHint" : beginner ? "automaticHint" : "configureHint"}`)}</p>
            {step === 0 ? <>
                <OneYesLoginForm />
                <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-border pt-3">
                    <Button type="text" size="small" disabled={busy} onClick={() => void account.connect("reuse")}>{t("config.account.reuse")}</Button>
                    <Button type="text" size="small" disabled={busy} onClick={() => { useOneYesAccountStore.setState({ error: "" }); setManual(true); }}>{t("config.account.manual")}</Button>
                </div>
            </> : manual && !result ? <OneYesManualForm onBusyChange={setManualBusy} onSaved={() => setResult(true)} /> : <>
                {account.user && <div className="mb-4 truncate text-xs text-muted-foreground">{account.user.username || account.user.email} · {t(`config.account.${account.source === "desktop" ? "shared" : "signedIn"}`)}</div>}
                <div className="divide-y divide-border border-y border-border" aria-busy={busy}>
                    {services.map(service => {
                        const report = result ? account.report.find(item => item.id === service.id) : undefined;
                        const ready = result && verified.includes(service.id);
                        const Icon = service.icon;
                        const Status = ready ? CheckCircle2 : report && report.code !== "unconfigured" ? CircleAlert : CircleDashed;
                        const channel = config.channels.find(channel => channel.id === service.id);
                        return <div key={service.id} className="py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3"><Icon className="size-4 shrink-0 text-muted-foreground" /><div><div className="text-sm font-medium">{t(`config.account.${service.purpose}`)}</div><div className="mt-1 text-xs text-muted-foreground">{service.name} · {channel?.oneYes?.groupName || service.group}</div></div></div>
                                <span className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: ready ? token.colorSuccessText : result ? token.colorWarningText : token.colorTextSecondary }}><Status className="size-3.5" />{busy ? t("config.onboarding.preparing") : result ? t(`config.account.status.${report?.code || "unconfigured"}`) : t("config.onboarding.autoMatch")}</span>
                            </div>
                            {result && !ready && <p className="mb-0 mt-2 break-words pl-7 text-xs leading-relaxed text-muted-foreground">{report?.detail || t(`config.account.diagnosis.${report?.code || "unconfigured"}`)}</p>}
                        </div>;
                    })}
                </div>
                {account.error && <Alert className="mt-4" type="error" showIcon title={account.error} />}
                <p className="mb-4 mt-3 text-xs leading-relaxed text-muted-foreground">{t(manual ? "config.onboarding.manualChecked" : "config.onboarding.keyHint")}</p>
                {result && verified.length > 0 ? <Button block type="primary" disabled={busy} icon={<CheckCircle2 className="size-4" />} onClick={() => { useConfigStore.getState().closeSetup("completed"); navigate("/"); }}>{t("config.onboarding.start")}</Button> : beginner && !manual && !result ? <div role="status" className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"><LoaderCircle className={reduceMotion ? "size-4" : "size-4 animate-spin"} />{t("config.onboarding.automatic")}</div> : <Button block type="primary" loading={busy} icon={<WandSparkles className="size-4" />} onClick={() => account.user ? void configure() : (setResult(false), setManual(true))}>{t(result ? (account.user ? "config.onboarding.retry" : "config.account.manual") : "config.onboarding.configure")}</Button>}
                {result && verified.length > 0 && verified.length < services.length && account.user && <Button block type="text" className="mt-2" loading={busy} onClick={() => void configure()}>{t("config.onboarding.retry")}</Button>}
            </>}
            {desktop && step !== 0 && (!result || verified.length < services.length) && <Button block type="text" className="mt-2" disabled={busy} onClick={() => { if (manual) attemptedAccount.current = null; setResult(false); setManual(!manual); }}>{t(manual ? "config.onboarding.useAccount" : "config.account.manual")}</Button>}
        </motion.div>
        {desktop && !busy && !result && <Button block type="text" className="mt-3" onClick={() => { attemptedAccount.current = null; setManual(false); useConfigStore.getState().setSetupMode(beginner ? "expert" : "beginner"); }}>{t(`config.onboarding.${beginner ? "switchExpert" : "switchBeginner"}`)}</Button>}
        {(!result || !verified.length) && <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-3"><span className="text-xs text-muted-foreground">{t("config.onboarding.laterHint")}</span><Button type="text" size="small" disabled={busy} onClick={close}>{t("config.onboarding.later")}</Button></div>}
    </Modal>;
}
