import { Button, Input } from "antd";
import { Check, ChevronDown, KeyRound, Link2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";

export function AgentConnectView({ theme, url, token, enabled, connected, activity, connectError, onUrlChange, onTokenChange, onToggleEnabled }: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string; token: string; enabled: boolean; connected: boolean; activity: string; connectError: string;
    onUrlChange: (value: string) => void; onTokenChange: (value: string) => void; onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const configured = useAgentStore(s => s.codexConfigured);
    const busy = useAgentStore(s => s.codexSetupBusy);
    const setup = useAgentStore(s => s.setupDesktopCodex);
    const setAgentState = useAgentStore(s => s.setAgentState);
    const desktop = !!window.oneYesDesktop?.agent;
    const ready = configured && connected && !connectError;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2.5">
                <PlugZap className="size-6" strokeWidth={1.5} />
                <h3 className="text-base font-semibold">{t("agent.connect.codexTitle")}</h3>
            </div>
            <p className="mt-3 text-sm leading-6" style={{ color: theme.node.muted }}>{t("agent.connect.codexDescription")}</p>
            <div className="my-5 space-y-3 text-xs" style={{ color: theme.node.muted }}>
                {["automaticSetup", "persistentSetup", "preserveSetup"].map(key => (
                    <div key={key} className="flex items-center gap-2"><Check className="size-3.5 shrink-0" />{t(`agent.connect.${key}`)}</div>
                ))}
            </div>
            <Button block size="large" type="primary" loading={busy || (configured && enabled && !connected && !connectError)} disabled={!desktop}
                icon={ready ? <Check className="size-4" /> : <PlugZap className="size-4" />}
                onClick={() => ready ? setAgentState({ activeTab: "chat" }) : void setup()}>
                {t(`agent.connect.${busy ? "settingUp" : ready ? "startChat" : connectError ? "retrySetup" : configured ? "reconnectCodex" : "oneClickSetup"}`)}
            </Button>
            <div role="status" aria-live="polite" className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                {desktop ? ready ? t("agent.connect.setupComplete") : busy ? t("agent.connect.setupProgress") : t("agent.connect.restartHint") : t("agent.connect.desktopOnly")}
            </div>
            {connectError && <div role="alert" className="mt-3 text-xs leading-5 text-red-500">{connectError}</div>}
            <details className="mt-6 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-xs" style={{ color: theme.node.muted }}>
                    {t("agent.connect.advanced")}<ChevronDown className="size-3.5" />
                </summary>
                <div className="space-y-3 pt-2">
                    <label className="grid gap-1.5 text-xs"><span>{t("agent.connect.localAddress")}</span>
                        <Input prefix={<Link2 className="size-3.5" />} value={url} onChange={event => onUrlChange(event.target.value)} /></label>
                    <label className="grid gap-1.5 text-xs"><span>{t("agent.connect.token")}</span>
                        <Input.Password prefix={<KeyRound className="size-3.5" />} value={token} onChange={event => onTokenChange(event.target.value)} /></label>
                    <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                        <span>{connected ? activity : t(enabled ? "agent.status.connecting" : "agent.status.disconnected")}</span>
                        <Button size="small" onClick={onToggleEnabled}>{t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}</Button>
                    </div>
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.disconnectHint")}</p>
                </div>
            </details>
        </div>
    );
}
