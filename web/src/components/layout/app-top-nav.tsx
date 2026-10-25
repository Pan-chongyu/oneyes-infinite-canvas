import { Bot, House, Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const navigation = [{ slug: "home", icon: House, to: "/" }, ...navigationTools.map((tool) => ({ ...tool, to: `/${tool.slug}` }))];

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <aside className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 md:h-full md:w-[208px] md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:px-3">
                    <Link to="/" className="flex min-h-14 items-center gap-2.5 text-sm font-semibold leading-none !text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-20 md:px-3" aria-label="OneYes Canvas">
                        <span
                            className="size-6 shrink-0 bg-current"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                        <span className="flex flex-col gap-1.5">
                            <span className="text-[15px] font-semibold">OneYes Canvas</span>
                            <span className="hidden text-xs font-normal text-muted-foreground md:block">{t("meta.title")}</span>
                        </span>
                    </Link>

                    <div className="flex items-center gap-1 md:hidden">
                        <UserStatusActions showConfig={false} />
                        <button
                            type="button"
                            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t("topNav.openMenu")}
                            title={t("topNav.menu")}
                        >
                            <Menu className="size-5" />
                        </button>
                    </div>

                    <nav className="hidden min-h-0 flex-1 flex-col gap-1 overflow-y-auto md:flex" aria-label={t("topNav.navigation")}>
                        {navigation.map((tool) => {
                            const Icon = tool.icon;
                            const active = tool.to === "/" ? pathname === "/" : tool.slug === activeToolSlug;
                            return (
                                <Link
                                    key={tool.slug}
                                    to={tool.to}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        active ? "!bg-sidebar-accent font-medium !text-sidebar-accent-foreground" : "!text-muted-foreground hover:!bg-sidebar-accent/60 hover:!text-foreground",
                                    )}
                                >
                                    <Icon className="size-4 shrink-0" strokeWidth={active ? 2 : 1.7} />
                                    <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                </Link>
                            );
                        })}
                    </nav>
                    <div className={`hidden shrink-0 space-y-3 border-t border-border pt-3 md:block ${window.oneYesDesktop?.updates ? 'pb-12' : 'pb-4'}`}>
                        <button
                            type="button"
                            onClick={togglePanel}
                            aria-expanded={panelOpen}
                            className={cn("flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors hover:bg-sidebar-accent", panelOpen ? "bg-sidebar-accent text-foreground" : "text-muted-foreground")}
                        >
                            <Bot className="size-4 shrink-0" />
                            <span className="flex-1">{t("topNav.assistant")}</span>
                            {agentConnected ? <span className="size-1.5 rounded-full bg-emerald-500" aria-label={t("agent.status.connected")} /> : null}
                        </button>
                        <div className="flex items-center justify-between px-2">
                            <span className="min-w-0 truncate text-xs text-muted-foreground">{t("home.workspaceLabel")}</span>
                            <UserStatusActions showConfig={false} />
                        </div>
                    </div>
                </aside>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
