export type CreatorTool = "analyze" | "concat" | "cutout" | "compose" | "superResolution";
export type CreatorLayer = { x?: number; y?: number; scale?: number; opacity?: number; blend?: "source-over" | "multiply" | "screen" };
export type CreatorSettings = {
    sourceIds?: string[];
    threshold?: number;
    clips?: boolean;
    audio?: boolean;
    trims?: Record<string, { start?: number; end?: number }>;
    layers?: Record<string, CreatorLayer>;
    resultCount?: number;
};
export type CreatorProgress = { stage: string; progress?: number };
export type CreatorArtifact = { name: string; kind: "image" | "video" | "audio" | "text"; blob: Blob; time?: number };
export type CreatorProcessor = {
    start(nodeId: string): Promise<void>;
    cancel(nodeId: string): void;
    state(nodeId: string): CreatorProgress | undefined;
};
