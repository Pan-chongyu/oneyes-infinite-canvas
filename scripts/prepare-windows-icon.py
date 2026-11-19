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
            # Match OneYes Windows icons: the rounded tile fills each ICO frame.
            frames.append(artwork.resize((size, size), Image.Resampling.LANCZOS))
        frames[-1].save(ROOT / "desktop/resources/icon.ico", format="ICO", sizes=[(size, size) for size in SIZES], append_images=frames[:-1])
    print("Windows ICO: " + ", ".join(f"{size}px" for size in SIZES))


if __name__ == "__main__":
    main()
