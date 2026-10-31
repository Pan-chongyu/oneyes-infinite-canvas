export function CanvasRefreshShell() {
    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" aria-busy="true">
            <div className="flex h-[52px] shrink-0 items-center justify-between px-4" aria-hidden="true">
                <div className="flex items-center gap-4"><div className="size-5 rounded bg-current opacity-10" /><div className="h-3 w-36 rounded bg-current opacity-10" /></div>
                <div className="h-3 w-24 rounded bg-current opacity-10" />
            </div>
            <div className="flex min-h-0 flex-1" aria-hidden="true">
                <div className="flex w-16 shrink-0 flex-col items-center gap-6 py-5">
                    {Array.from({ length: 7 }).map((_, index) => <div key={index} className="size-5 rounded bg-current opacity-10" />)}
                </div>
                <div className="flex-1 opacity-60" style={{ backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
            </div>
            <div className="flex h-11 shrink-0 items-center justify-end gap-3 px-4" aria-hidden="true"><div className="h-1 w-20 rounded bg-current opacity-10" /><div className="h-3 w-10 rounded bg-current opacity-10" /></div>
        </main>
    );
}
