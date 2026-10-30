import { useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, BookOpen, Check, LoaderCircle, Puzzle, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { builtinPlugins, isBuiltinPlugin, installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import { usePluginInstaller } from "@/hooks/use-plugin-installer";
import { CanvasPluginGuideModal } from "./canvas-plugin-guide-modal";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("official");
    const [dragging, setDragging] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const { importing, installFiles } = usePluginInstaller();

    const localPlugins = useMemo(() => plugins.filter((item) => item.local && !isBuiltinPlugin(item.id)), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !isBuiltinPlugin(item.id)), [plugins]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target);
            message.success(t("canvas.plugins.installedPlugin", { name: plugin.name }));
            setUrl("");
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setInstalling(false);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // Installed plugin actions: enable toggle plus update/uninstall for non-local plugins.
    // Highlight the update action when a newer remote version is available.
    const installedControls = (record: InstalledPlugin, upgradable = false) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    {record.url ? <Button
                        type={upgradable ? "primary" : "text"}
                        size="small"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), t("canvas.plugins.updated"))}
                    /> : null}
                    <Popconfirm title={t("canvas.plugins.uninstallTitle")} okText={t("canvas.plugins.uninstall")} cancelText={t("canvas.editors.cancel")} onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title={t("canvas.plugins.uninstall")} />
                    </Popconfirm>
                </>
            )}
        </>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-4 text-center text-xs" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // Shared plugin row: icon, title with name and version, description, and actions.
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="pb-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                {t("canvas.plugins.builtinDescription")}
            </div>
            <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                {builtinPlugins.map((plugin) => row(plugin.id, plugin.nodes[0]?.icon || <Puzzle className="size-4" />, plugin.name, plugin.version, plugin.description,
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs" style={{ color: theme.node.muted }}><Check className="size-3.5" />{t("canvas.plugins.builtinReady")}</span>,
                ))}
            </div>
        </div>
    );

    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>;

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{t("canvas.plugins.warning")}</span>
            </div>
            <button type="button" disabled={importing || installing} onClick={() => input.current?.click()} className="flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait" style={{ borderColor: dragging ? theme.node.text : theme.node.stroke, background: dragging ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}>
                {importing ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> : <Upload className="size-5" strokeWidth={1.6} />}
                <span>{t(importing ? "canvas.plugins.importing" : dragging ? "canvas.plugins.dropToInstall" : "canvas.plugins.dropFile")}</span>
                <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.plugins.fileHint")}</span>
            </button>
            <input ref={input} type="file" accept=".js,.mjs" multiple hidden aria-label={t("canvas.plugins.selectFile")} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void installFiles(files); }} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                <span>{t("canvas.plugins.fileUpdateHint")}</span>
                <Button type="text" size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setGuideOpen(true)}>{t("canvas.plugins.developGuide")}</Button>
            </div>
            <details>
                <summary className="cursor-pointer py-1 text-xs" style={{ color: theme.node.muted }}>{t("canvas.plugins.installFromUrl")}</summary>
                <div className="mt-2 flex gap-2">
                    <Input aria-label={t("canvas.plugins.urlPlaceholder")} placeholder={t("canvas.plugins.urlPlaceholder")} value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={() => { if (!installing && !importing) void handleInstallUrl(); }} allowClear />
                    <Button loading={installing} disabled={importing || !url.trim()} onClick={handleInstallUrl}>{t("canvas.plugins.install")}</Button>
                </div>
            </details>
            <div className="thin-scrollbar max-h-[32vh] space-y-2 overflow-auto">{thirdPartyPlugins.length === 0 ? emptyHint(t("canvas.plugins.noThirdParty")) : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.fileName ? `${record.fileName} · ${record.description || t("canvas.plugins.replaceFile")}` : record.description || record.url, installedControls(record)))}</div>
        </div>
    );

    const tabs = [
        { key: "official", label: t("canvas.plugins.builtin"), children: officialTab },
        ...(localPlugins.length > 0 ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }] : []),
        { key: "third", label: t("canvas.plugins.thirdParty"), children: thirdPartyTab },
    ];

    return (
        <>
            <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={640}>
                <div onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setActiveTab("third"); setDragging(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); setActiveTab("third"); if (!installing) void installFiles(Array.from(event.dataTransfer.files)); }}>
                    <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
                </div>
            </Modal>
            <CanvasPluginGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
        </>
    );
}
