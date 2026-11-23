export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
};

export type ImageTransferProgress = {
    phase: "download" | "saving";
    receivedBytes: number;
    totalBytes?: number;
    image?: { url: string; width: number; height: number };
};
