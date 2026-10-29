import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "motion/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import "./desktop-titlebar.css";

export function DesktopTitlebar() {
    const api = window.oneYesDesktop?.windowChrome;
    const theme = useThemeStore((state) => state.theme);
    const { pathname } = useLocation();
    const canvas = /^\/canvas\/[^/]+/.test(pathname);
    const sideWidth = useCanvasSidePanelStore((state) => state.width);
    const sideOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sideMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const agentWidth = useAgentStore((state) => state.width);
    const agentOpen = useAgentStore((state) => state.panelOpen);
    const agentMounted = useAgentStore((state) => state.panelMounted);
    const colors = canvasThemes[theme];
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => {
        if (!api) return;
        let active = true;
        const stop = api.subscribe((value) => { if (active) setFullscreen(value); });
        void api.fullscreen().then((value) => { if (active) setFullscreen(value); }).catch(() => {});
        return () => { active = false; stop(); };
    }, [api]);

    useEffect(() => { if (api) void api.theme(theme).catch(() => {}); }, [api, theme]);

    if (!api || fullscreen) return null;
    return (
        <header className="desktop-titlebar relative flex shrink-0 bg-background" aria-label="窗口标题栏" data-platform={api.platform} style={canvas ? { background: colors.canvas.background } : undefined}>
            {!canvas ? <div aria-hidden="true" className="hidden h-full w-[208px] shrink-0 border-r border-border bg-sidebar md:block" /> : null}
            {canvas && sideMounted ? <motion.div aria-hidden="true" className="absolute inset-y-0 left-0 origin-left border-r" style={{ width: sideWidth + 1, background: colors.toolbar.panel, borderColor: colors.toolbar.border }} initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: sideOpen ? 1 : 0, opacity: sideOpen ? 1 : 0 }} transition={{ duration: CANVAS_SIDE_PANEL_MOTION_MS / 1000, ease: [0.22, 1, 0.36, 1] }} /> : null}
            {agentMounted ? <motion.div aria-hidden="true" className="absolute inset-y-0 right-0 origin-right border-l" style={{ width: agentWidth + 1, background: colors.node.panel, borderColor: colors.node.stroke }} initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: agentOpen ? 1 : 0, opacity: agentOpen ? 1 : 0 }} transition={{ duration: CANVAS_AGENT_PANEL_MOTION_MS / 1000, ease: [0.22, 1, 0.36, 1] }} /> : null}
        </header>
    );
}
