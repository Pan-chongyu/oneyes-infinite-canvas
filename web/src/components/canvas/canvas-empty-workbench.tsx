import { Image as ImageIcon, Type, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasEmptyWorkbench({ onImage, onVideo, onText, onImport }: { onImage: () => void; onVideo: () => void; onText: () => void; onImport: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    return <div className="creator-empty" data-canvas-empty>
        <section className="creator-empty-content" aria-label={t("canvas.workbench.start")}>
            <div className="creator-empty-art" aria-hidden="true"><span><Type size={22} /></span><span><Video size={23} /></span><span><ImageIcon size={28} strokeWidth={1.2} /></span></div>
            <h1>{t("canvas.workbench.start")}</h1>
            <p style={{ color: theme.node.muted }}>{t("canvas.workbench.description")}</p>
            <div className="creator-starters" data-canvas-no-zoom>
                <button type="button" className="creator-starter" onClick={onImage}><ImageIcon />{t("canvas.workbench.addImage")}</button>
                <button type="button" className="creator-starter" onClick={onVideo}><Video />{t("canvas.workbench.addVideo")}</button>
                <button type="button" className="creator-starter" onClick={onText}><Type />{t("canvas.workbench.addText")}</button>
                <button type="button" className="creator-starter" onClick={onImport}><Upload />{t("canvas.workbench.import")}</button>
            </div>
            <span className="creator-empty-hint">{t("canvas.workbench.hint")}</span>
        </section>
    </div>;
}
