import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Download, Home, Images, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <header className="creator-header" style={{ background: theme.node.panel }}>
                <div className="flex min-w-0 items-center gap-2">
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="creator-icon"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <button type="button" onClick={onProjects} className="creator-header-context text-xs whitespace-nowrap hover:opacity-70" style={{ color: theme.node.muted }}>{t("canvas.projects")}</button>
                    <ChevronRight className="creator-header-context size-3 shrink-0 opacity-35" />
                    <div ref={titleRef} className="flex min-w-0 items-center">
                        {isTitleEditing ? (
                            <input autoFocus value={titleDraft} aria-label={t("canvas.project.rename")} onChange={event => onTitleDraftChange(event.target.value)} onBlur={onFinishTitleEditing}
                                onKeyDown={event => { if (event.key === "Enter") onFinishTitleEditing(); if (event.key === "Escape") onCancelTitleEditing(); }}
                                className="w-40 max-w-full bg-transparent text-[13px] font-medium outline-none" style={{ color: theme.node.text }} />
                        ) : <button type="button" className="max-w-[min(24vw,240px)] truncate text-left text-[13px] font-medium" onDoubleClick={onStartTitleEditing} title={t("canvas.renameHint")}>{title}</button>}
                    </div>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: t("canvas.home"), onClick: onHome },
                                { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                { key: "rename", icon: <Pencil className="size-4" />, label: t("canvas.project.rename"), onClick: onStartTitleEditing },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                            ],
                        }}
                    >
                        <button type="button" className="creator-icon !size-6" style={{ color: theme.node.muted }} aria-label={t("canvas.openMenu")}>
                            <ChevronDown className="size-3.5" />
                        </button>
                    </Dropdown>

                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <Tooltip title={t("canvas.undo")}><button type="button" className="creator-icon" disabled={!canUndo} aria-label={t("canvas.undo")} onClick={onUndo}><Undo2 size={15} /></button></Tooltip>
                    <Tooltip title={t("canvas.redo")}><button type="button" className="creator-icon" disabled={!canRedo} aria-label={t("canvas.redo")} onClick={onRedo}><Redo2 size={15} /></button></Tooltip>
                    <span className="mx-2 h-4 w-px opacity-40" style={{ background: theme.toolbar.border }} />
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    <button type="button" className="creator-assistant ml-2" aria-expanded={agentOpen} onClick={onToggleAgent} title={compactAgentStatus.connected ? t("canvas.agentConnected") : compactAgentStatus.enabled ? t("canvas.agentConnecting", { activity: compactAgentStatus.activity || t("canvas.connecting") }) : t("canvas.agentDisconnected")}>
                        <Bot size={16} /><span>{t("canvas.workbench.assistant")}</span><span className={`size-1.5 rounded-full ${compactAgentStatus.enabled && !compactAgentStatus.connected ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ background: compactAgentStatus.connected ? '#22c55e' : compactAgentStatus.enabled ? '#f59e0b' : theme.node.faint }} />
                    </button>
                </div>
            </header>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={[t("canvas.shortcut.drag")]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "G"]} value={t("canvas.shortcut.group")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "G"]} value={t("canvas.shortcut.ungroup")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                </div>
            </Modal>
        </>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
