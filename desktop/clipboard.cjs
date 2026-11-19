function readClipboard(clipboard) {
    const image = clipboard.readImage();
    if (!image.isEmpty()) return { image: new Uint8Array(image.toPNG()) };
    return { text: clipboard.readText() };
}
module.exports = { readClipboard };
