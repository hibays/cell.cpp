"""Pack the ffmpeg-rendered PNGs into platform icon bundles.

* cell.ico            — Windows (PNG-in-ICO, Vista+): 16..256
* macos.iconset/      — run `iconutil -c icns macos.iconset` on a mac
* linux-hicolor/      — drop into /usr/share/icons/hicolor/<size>/apps/cell.png

The SVG is rendered by ffmpeg (librsvg decoder):
    ffmpeg -i cell-logo.svg -vf scale=N:N png/cell-N.png
"""
import struct
import sys
from pathlib import Path

HERE = Path(__file__).parent
PNG = HERE / "png"

# (width, height) pairs for the Windows .ico
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
# macOS iconset entries: name -> pixel size
MACOS = {
    "icon_16x16": 16, "icon_16x16@2x": 32,
    "icon_32x32": 32, "icon_32x32@2x": 64,
    "icon_128x128": 128, "icon_128x128@2x": 256,
    "icon_256x256": 256, "icon_256x256@2x": 512,
    "icon_512x512": 512, "icon_512x512@2x": 1024,
}
# freedesktop hicolor standard sizes
LINUX = [16, 24, 32, 48, 64, 128, 256]


def pack_ico(out: Path, sizes: list[int]) -> None:
    pngs = []
    for s in sizes:
        data = (PNG / f"cell-{s}.png").read_bytes()
        pngs.append((s, data))
    # ICONDIR: reserved, type=1 (icon), count
    ico = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    for s, data in pngs:
        w = 0 if s >= 256 else s  # 256 is encoded as 0
        # width, height, colors=0, reserved, planes=1, bpp=32,
        # bytes, offset — PNG payloads are used verbatim
        ico += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in pngs:
        ico += data
    out.write_bytes(ico)
    print(f"{out.name}: {out.stat().st_size} bytes, {len(pngs)} sizes")


def main() -> int:
    pack_ico(HERE / "cell.ico", ICO_SIZES)

    mac = HERE / "macos.iconset"
    mac.mkdir(exist_ok=True)
    for name, s in MACOS.items():
        (mac / f"{name}.png").write_bytes((PNG / f"cell-{s}.png").read_bytes())
    print("macos.iconset/: run `iconutil -c icns macos.iconset -o cell.icns` on macOS")

    lin = HERE / "linux-hicolor"
    for s in LINUX:
        d = lin / f"{s}x{s}" / "apps"
        d.mkdir(parents=True, exist_ok=True)
        (d / "cell.png").write_bytes((PNG / f"cell-{s}.png").read_bytes())
    print("linux-hicolor/: freedesktop hicolor tree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
