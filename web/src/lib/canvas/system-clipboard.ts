// Read only after an explicit paste action. Desktop uses the trusted native bridge.
export async function readSystemClipboard(): Promise<File | File[] | string | null> {
    if (window.oneYesDesktop?.clipboard) {
        const data = await window.oneYesDesktop.clipboard.read();
        if (data.files?.length) return data.files.map(file => new File([new Uint8Array(file.image).buffer], file.name, { type: file.type }));
        return data.image?.length
            ? new File([new Uint8Array(data.image).buffer], data.type && data.type !== "image/png" ? "clipboard-image" : "clipboard-image.png", { type: data.type || "image/png" })
            : data.text || null;
    }
    const clipboard = navigator.clipboard;
    if (!clipboard) throw new Error("Clipboard unavailable");
    if (typeof clipboard.read !== "function") return await clipboard.readText() || null;
    const items = await clipboard.read();
    for (const item of items) {
        const type = item.types.find(type => type.startsWith("image/"));
        if (type) return new File([await item.getType(type)], "clipboard-image", { type });
    }
    for (const item of items) {
        if (item.types.includes("text/plain")) return (await item.getType("text/plain")).text();
    }
    return null;
}
