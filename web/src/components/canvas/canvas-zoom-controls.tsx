import { Compass, Focus } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number; nodeCount: number; selectedCount: number;
    onScaleChange: (scale: number) => void; onReset: () => void;
    isMiniMapOpen: boolean; onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, nodeCount, selectedCount, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    return <footer className="creator-status" style={{ background: theme.node.panel, color: theme.node.muted }} data-canvas-no-zoom>
        <div className="creator-status-count flex items-center gap-4">
            <span>{t("canvas.workbench.elementCount", { count: nodeCount })}{selectedCount ? ` / ${t("canvas.sidePanel.selected", { count: selectedCount })}` : ""}</span>
            <span className="creator-status-context opacity-45">{t("canvas.workbench.navigationHint")}</span>
        </div>
        <div className="flex items-center gap-2">
            <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}><button type="button" className="creator-icon" onClick={onToggleMiniMap} aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")} aria-pressed={isMiniMapOpen}><Compass size={15} /></button></Tooltip>
            <Tooltip title={t("canvas.resetView")}><button type="button" className="creator-icon" onClick={onReset} aria-label={t("canvas.resetView")}><Focus size={15} /></button></Tooltip>
            <input type="range" min="5" max="500" step="1" value={Math.round(scale * 100)} className="w-20 max-[460px]:w-14" style={{ accentColor: theme.node.activeStroke }} onChange={event => onScaleChange(Number(event.target.value) / 100)} aria-label={t("canvas.zoom")} />
            <span className="w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
        </div>
    </footer>;
}
