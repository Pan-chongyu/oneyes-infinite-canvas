import { unzipSync, zipSync } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

export async function createZip(files: ZipFile[]) {
    const names = new Set<string>();
    const entries = await Promise.all(
        files.map(async (file) => {
            validateZipEntryName(file.name);
            if (names.has(file.name)) throw new Error("ZIP 中存在重复文件");
            names.add(file.name);
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    const names = new Set<string>();
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: ({ name }) => {
        const directory = name.endsWith("/");
        validateZipEntryName(directory ? name.slice(0, -1) : name);
        if (names.has(name)) throw new Error("ZIP 中存在重复文件");
        names.add(name);
        return !directory;
    } });
    const result = new Map<string, Blob>();
    for (const [name, data] of Object.entries(entries)) {
        validateZipEntryName(name);
        if (result.has(name)) throw new Error("ZIP 中存在重复文件");
        result.set(name, new Blob([data]));
    }
    return result;
}

/** 只接受导入器需要的相对 POSIX 路径，拒绝目录穿越、绝对路径和编码绕过。 */
export function validateZipEntryName(name: string) {
    if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || /[\u0000-\u001f\u007f]/.test(name) || /%(?:2e|2f|5c)/i.test(name)) throw new Error("ZIP 文件路径无效");
    const parts = name.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("ZIP 文件路径无效");
    return name;
}
