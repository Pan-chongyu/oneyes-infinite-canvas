import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { OneYesSetupDialog } from "@/components/layout/oneyes-setup-dialog";
import { DesktopUpdate } from "@/components/layout/desktop-update";
import { DesktopTitlebar } from "@/components/layout/desktop-titlebar";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <DesktopTitlebar />
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
                    <AppTopNav />
                    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
                </div>
                <AgentPanel />
            </div>
            <OneYesSetupDialog />
            <DesktopUpdate />
        </div>
    );
}
