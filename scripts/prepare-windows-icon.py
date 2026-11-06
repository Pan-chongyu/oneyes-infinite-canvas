"""Generate the Windows desktop icon from the existing brand artwork (Pillow)."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def main():
    with Image.open(ROOT / "desktop/resources/icon.png") as source:
        source = source.convert("RGBA")
        artwork = source.crop(source.getchannel("A").getbbox())
        frames = []
        for size in SIZES:
            # Optical padding for this rounded tile; small sizes snap to whole pixels.
            inset = max(1, round(size / 16))
            tile = artwork.resize((size - 2 * inset, size - 2 * inset), Image.Resampling.LANCZOS)
            frame = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            frame.alpha_composite(tile, (inset, inset))
            frames.append(frame)
        frames[-1].save(ROOT / "desktop/resources/icon.ico", format="ICO", sizes=[(size, size) for size in SIZES], append_images=frames[:-1])
    print("Windows ICO: " + ", ".join(f"{size}px" for size in SIZES))


if __name__ == "__main__":
    main()
