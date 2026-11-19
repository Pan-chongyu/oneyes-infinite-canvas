"""Render the existing Canvas glyph as black/alpha macOS template images (Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent


def main():
    # Same two paths as web/public/logo.svg; no app-icon tile in the menu bar.
    glyph = Image.new("RGBA", (512, 512))
    draw = ImageDraw.Draw(glyph)
    for points in (
        [(32, 8), (58, 54), (46, 54), (32, 29), (18, 54), (6, 54)],
        [(32, 40), (40, 54), (24, 54)],
    ):
        draw.polygon([(x * 8, y * 8) for x, y in points], fill=(0, 0, 0, 255))
    for scale in (1, 2):
        name = "trayTemplate" + ("@2x" if scale == 2 else "") + ".png"
        glyph.resize((16 * scale, 16 * scale), Image.Resampling.LANCZOS).save(
            ROOT / "desktop/resources" / name, dpi=(72 * scale, 72 * scale)
        )


if __name__ == "__main__":
    main()
