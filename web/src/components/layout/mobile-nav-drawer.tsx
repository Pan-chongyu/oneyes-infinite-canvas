import { Drawer } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { Bot, House } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const togglePanel = useAgentStore((state) => state.togglePanel);

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                <Link
                    to="/"
                    onClick={onClose}
                    aria-current={pathname === "/" ? "page" : undefined}
                    className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        pathname === "/" ? "!bg-accent font-medium !text-accent-foreground" : "!text-muted-foreground hover:!bg-accent hover:!text-foreground",
                    )}
                >
                    <House className="size-5" />
                    <span>{t("navigation.home")}</span>
                </Link>
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                active ? "!bg-accent font-medium !text-accent-foreground" : "!text-muted-foreground hover:!bg-accent hover:!text-foreground",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
                <button
                    type="button"
                    onClick={() => {
                        onClose();
                        togglePanel();
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-base text-foreground transition-colors hover:bg-accent"
                >
                    <Bot className="size-5" />
                    <span>{t("topNav.assistant")}</span>
                </button>
            </div>
        </Drawer>
    );
}
