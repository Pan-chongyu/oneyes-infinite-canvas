import type { CSSProperties } from "react";
import { Dropdown, Tooltip } from "antd";
import { BookOpen, Keyboard, Languages, Moon, MoreHorizontal, Puzzle, Settings2, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@/constant/env";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });

    if (variant === "canvas") return <div className="inline-flex items-center gap-1">
        {showConfig ? <Tooltip title={t("navigation.config")}><button type="button" className="creator-icon" onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")}><Settings2 size={16} /></button></Tooltip> : null}
        <Dropdown trigger={["click"]} menu={{ items: [
            ...(onOpenPlugins ? [{ key: "plugins", label: t("topNav.plugins"), icon: <Puzzle size={16} />, onClick: onOpenPlugins }] : []),
            { key: "docs", label: t("topNav.docs"), icon: <BookOpen size={16} />, onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
            ...(onOpenShortcuts ? [{ key: "shortcuts", label: t("topNav.shortcuts"), icon: <Keyboard size={16} />, onClick: onOpenShortcuts }] : []),
            { key: "language", label: languageLabel, icon: <Languages size={16} />, onClick: () => void changeAppLocale(nextLocale) },
            { key: "theme", label: t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme"), icon: theme === "dark" ? <Sun size={16} /> : <Moon size={16} />, onClick: () => setTheme(theme === "dark" ? "light" : "dark") },
        ] }}><button type="button" className="creator-icon" aria-label={t("canvas.workbench.more")}><MoreHorizontal size={17} /></button></Dropdown>
    </div>;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.docs")} title={t("topNav.docs")}>
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={`${naturalIconClass} text-[11px] font-semibold tracking-tight`} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
