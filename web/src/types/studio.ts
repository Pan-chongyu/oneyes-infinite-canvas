export type StudioTool = "storyboard" | "reference" | "batch" | "compare" | "subtitles" | "ocr" | "export";
export type StoryShot = { title: string; picture: string; dialogue: string; seconds: number; camera: string };
export type SubtitleCue = { start: number; end: number; text: string };
export type BatchItem = { id: string; prompt: string; state: "pending" | "started" | "done" };
export type StudioSettings = {
    sourceIds?: string[];
    text?: string;
    model?: string;
    shots?: StoryShot[];
    cues?: SubtitleCue[];
    items?: BatchItem[];
    selectedId?: string;
    comparison?: "side" | "wipe";
    wipe?: number;
    role?: string;
    outfit?: string;
    style?: string;
};
