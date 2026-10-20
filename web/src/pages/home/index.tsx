import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, ChevronRight, HardDrive, ImagePlus, Maximize2, Plus, Video } from "lucide-react";
import { Skeleton } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function HomePage() {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const recentProjects = projects
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 6);
    const createCanvas = () => navigate(`/canvas/${createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))}`);

    return (
        <main className="@container flex h-full flex-col overflow-y-auto bg-background text-foreground">
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-5 md:px-8">
                <h1 className="text-base font-semibold">{t("navigation.home")}</h1>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HardDrive className="size-3.5" />
                    {t("home.workspaceLabel")}
                </span>
            </header>

            <motion.div initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }} className="mx-auto w-full max-w-[1184px] px-5 py-7 md:px-8">
                <section aria-labelledby="start-heading">
                    <h2 id="start-heading" className="mb-3 text-sm font-medium">
                        {t("home.startCreating")}
                    </h2>
                    <div className="grid gap-3 @min-[600px]:grid-cols-3">
                        <button
                            type="button"
                            disabled={!hydrated}
                            onClick={createCanvas}
                            className="group flex min-h-22 cursor-pointer items-start gap-4 rounded-xl border border-border bg-secondary/70 p-4 text-left transition-colors duration-200 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 @min-[600px]:min-h-28 @min-[600px]:p-5"
                        >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                                <Plus className="size-5 transition-transform duration-200 motion-safe:group-hover:rotate-90" />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold leading-5">{t("home.newCanvas")}</span>
                                <span className="mt-2 block text-xs leading-5 text-muted-foreground">{t("home.canvasDescription")}</span>
                            </span>
                        </button>
                        {[
                            { slug: "image", icon: ImagePlus, description: "imageDescription" },
                            { slug: "video", icon: Video, description: "videoDescription" },
                        ].map(({ slug, icon: Icon, description }) => (
                            <Link
                                key={slug}
                                to={`/${slug}`}
                                className="group flex min-h-22 items-start gap-4 rounded-xl border border-border !bg-card/35 p-4 !text-foreground transition-colors duration-200 hover:!bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @min-[600px]:min-h-28 @min-[600px]:p-5"
                            >
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                                    <Icon className="size-5" strokeWidth={1.6} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-1 text-sm font-medium leading-5">
                                        {t(`navigation.${slug}`)}
                                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
                                    </span>
                                    <span className="mt-2 block text-xs leading-5 text-muted-foreground">{t(`home.${description}`)}</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>

                <section className="mt-8" aria-labelledby="recent-heading" aria-busy={!hydrated}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id="recent-heading" className="flex items-center gap-2 text-sm font-medium">
                            {t("home.recentCanvases")}
                            {hydrated && projects.length > 0 ? <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">{projects.length}</span> : null}
                        </h2>
                        <Link to="/canvas" className="flex min-h-8 items-center gap-1 rounded-md px-1 text-xs !text-muted-foreground transition-colors hover:!text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {t("home.allCanvases")}
                            <ChevronRight className="size-3.5" />
                        </Link>
                    </div>

                    {!hydrated ? (
                        <div className="divide-y divide-border rounded-xl border border-border px-4" aria-label={t("canvas.loading")}>
                            {Array.from({ length: 4 }, (_, index) => (
                                <div key={index} className="flex h-[72px] items-center gap-4">
                                    <Skeleton.Avatar active={!reduceMotion} shape="square" size={36} />
                                    <Skeleton active={!reduceMotion} title={false} paragraph={{ rows: 1, width: "48%" }} className="max-w-md" />
                                </div>
                            ))}
                        </div>
                    ) : recentProjects.length > 0 ? (
                        <div className="overflow-hidden rounded-xl border border-border">
                            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground">
                                <span>{t("home.projectName")}</span>
                                <span className="hidden pr-7 @min-[520px]:inline">{t("home.lastModified")}</span>
                            </div>
                            <div className="divide-y divide-border">
                                {recentProjects.map((project) => (
                                    <Link
                                        key={project.id}
                                        to={`/canvas/${project.id}`}
                                        className="group grid min-h-[76px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-4 !text-foreground transition-colors duration-150 hover:!bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                        title={project.title}
                                    >
                                        <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-secondary/40 text-muted-foreground">
                                            <Maximize2 className="size-4" strokeWidth={1.6} />
                                        </span>
                                        <span className="min-w-0 py-3">
                                            <span className="block truncate text-sm font-medium leading-5">{project.title}</span>
                                            <span className="mt-1 block text-xs leading-4 text-muted-foreground">{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</span>
                                        </span>
                                        <span className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <time dateTime={project.updatedAt} className="hidden tabular-nums @min-[520px]:inline">
                                                {new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                            </time>
                                            <ChevronRight className="size-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/20 px-5 py-8 text-center @min-[600px]:min-h-72">
                            <span className="mb-5 flex size-14 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
                                <Maximize2 className="size-6" strokeWidth={1.3} />
                            </span>
                            <h3 className="text-sm font-medium leading-6">{t("home.emptyCanvases")}</h3>
                            <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{t("home.emptyDescription")}</div>
                        </div>
                    )}
                </section>

                <div className="mt-5 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                    <HardDrive className="size-3.5 shrink-0" />
                    {t("home.localData")}
                </div>
            </motion.div>
        </main>
    );
}
