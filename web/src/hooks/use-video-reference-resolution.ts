import { useEffect } from "react";
import { normalizeGrokVideoConfig, type VideoReferenceSummary } from "@/lib/video-capabilities";
import type { AiConfig } from "@/stores/use-config-store";

export function useVideoReferenceResolution(config: AiConfig, inputs: VideoReferenceSummary, onChange: (key: "vquality" | "size", value: string) => void) {
    const effective = normalizeGrokVideoConfig(config, inputs);
    const quality = effective.vquality, size = effective.size;
    useEffect(() => {
        if (config.vquality !== quality) onChange("vquality", quality);
        if (config.size !== size) onChange("size", size);
    }, [config.vquality, config.size, quality, size, onChange]);
    return effective;
}
