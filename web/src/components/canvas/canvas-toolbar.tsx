import type { ReactNode } from "react";
import { useState } from "react";
import { Dropdown, Popover, Segmented, Switch, Tooltip } from "antd";
import { Eraser, Group, Hand, Image as ImageIcon, LocateFixed, MoreHorizontal, MousePointer2, Music2, Palette, Settings2, Trash2, Type, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = {
    selectedCount: number; canvasTool: "select" | "pan"; backgroundMode: CanvasBackgroundMode; showImageInfo: boolean;
    onAddImage: () => void; onAddVideo: () => void; onAddAudio: () => void; onAddText: () => void;
    onAddConfig: () => void; onAddGroup: () => void; onAddExtensionNode: (type: string) => void;
    onUpload: () => void; onDelete: () => void; onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void; onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void; onFocusSelected: () => void;
};

export function CanvasToolbar(props: Props) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore(state => state.theme);
    const theme = canvasThemes[colorTheme];
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    useNodeRegistryVersion();
    const extensions = listNodeDefinitions().filter(def => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const more = [
        { key: "config", label: t("canvas.toolbar.config"), icon: <Settings2 size={16} />, onClick: props.onAddConfig },
        { key: "group", label: t("canvas.toolbar.group"), icon: <Group size={16} />, onClick: props.onAddGroup },
        ...extensions.map(def => ({ key: def.type, label: getNodeSpec(def.type).title, icon: <span className="inline-flex size-4 items-center justify-center">{def.icon}</span>, onClick: () => props.onAddExtensionNode(def.type) })),
    ];
    return <aside className="creator-tools" aria-label={t("canvas.workbench.tools")} data-canvas-no-zoom data-canvas-tools style={{ background: theme.node.panel, color: theme.toolbar.item, borderColor: theme.toolbar.border }}>
        <div className="creator-tools-scroll thin-scrollbar">
            <Tool label={t(`canvas.toolbar.${props.canvasTool}`)} active onClick={() => props.onCanvasToolChange(props.canvasTool === "select" ? "pan" : "select")}>
                {props.canvasTool === "select" ? <MousePointer2 /> : <Hand />}
            </Tool>
            <div className="creator-tools-rule" />
            <Tool label={t("canvas.toolbar.image")} caption onClick={props.onAddImage}><ImageIcon /></Tool>
            <Tool label={t("canvas.toolbar.video")} caption onClick={props.onAddVideo}><Video /></Tool>
            <Tool label={t("canvas.toolbar.text")} caption onClick={props.onAddText}><Type /></Tool>
            <Tool label={t("canvas.toolbar.audio")} caption onClick={props.onAddAudio}><Music2 /></Tool>
            <div className="creator-tools-rule" />
            <Tool label={t("canvas.workbench.import")} caption onClick={props.onUpload}><Upload /></Tool>
            <Dropdown menu={{ items: more }} trigger={["click"]} placement="bottomLeft">
                <button type="button" className="creator-tool" aria-label={t("canvas.toolbar.extensions")} title={t("canvas.toolbar.extensions")}><MoreHorizontal /><span>{t("canvas.workbench.more")}</span></button>
            </Dropdown>
            <div className="creator-tools-spacer" />
            {props.selectedCount > 0 ? <>
                <Tool label={t("canvas.toolbar.focus")} onClick={props.onFocusSelected}><LocateFixed /></Tool>
                <Tool label={t("canvas.deleteSelected")} onClick={props.onDelete}><Trash2 /></Tool>
            </> : null}
            <Popover trigger="click" placement="rightBottom" open={appearanceOpen} onOpenChange={setAppearanceOpen} content={<div className="w-[220px] space-y-4 py-1" data-canvas-no-zoom>
                <div className="text-[13px] font-medium">{t("canvas.toolbar.appearance")}</div>
                <div><div className="mb-2 text-xs opacity-60">{t("canvas.toolbar.gridStyle")}</div><Segmented block value={props.backgroundMode} onChange={value => props.onBackgroundModeChange(value as CanvasBackgroundMode)} options={[
                    { value: "dots", label: t("canvas.toolbar.dots") }, { value: "lines", label: t("canvas.toolbar.lines") }, { value: "blank", label: t("canvas.toolbar.blank") },
                ]} /></div>
                <div className="flex items-center justify-between gap-4 text-xs"><span>{t("canvas.toolbar.imageInfo")}</span><Switch size="small" checked={props.showImageInfo} onChange={props.onShowImageInfoChange} /></div>
            </div>}>
                <button type="button" className="creator-tool" aria-label={t("canvas.toolbar.appearance")} aria-expanded={appearanceOpen} data-active={appearanceOpen || undefined}><Palette /></button>
            </Popover>
            <Tool label={t("canvas.toolbar.clear")} onClick={props.onClear}><Eraser /></Tool>
        </div>
    </aside>;
}

function Tool({ label, children, caption, active, onClick }: { label: string; children: ReactNode; caption?: boolean; active?: boolean; onClick: () => void }) {
    return <Tooltip title={caption ? undefined : label} placement="right"><button type="button" className="creator-tool" aria-label={label} data-active={active || undefined} onClick={onClick}>{children}{caption ? <span>{label}</span> : null}</button></Tooltip>;
}
