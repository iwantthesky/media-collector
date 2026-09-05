from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def build_master(size=512):
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def s(value):
        return int(value * scale)

    rounded(draw, (s(18), s(18), s(494), s(494)), s(108), "#142432")
    rounded(draw, (s(102), s(116), s(390), s(304)), s(34), "#F8F4EC")
    rounded(draw, (s(130), s(144), s(362), s(276)), s(22), "#D9E8E5")
    draw.ellipse((s(164), s(174), s(216), s(226)), fill="#C63C32")
    draw.polygon(
        [(s(145), s(258)), (s(220), s(196)), (s(264), s(232)), (s(302), s(198)), (s(350), s(258))],
        fill="#4C8078",
    )
    draw.line((s(256), s(250), s(256), s(382)), fill="#FFFFFF", width=s(34))
    draw.polygon([(s(186), s(342)), (s(326), s(342)), (s(256), s(414))], fill="#FFFFFF")
    rounded(draw, (s(150), s(424), s(362), s(454)), s(15), "#C63C32")

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = build_master()
    for size in (16, 32, 48, 128):
        master.resize((size, size), Image.Resampling.LANCZOS).save(ICON_DIR / f"icon{size}.png")
    master.save(ICON_DIR / "icon512.png")


if __name__ == "__main__":
    main()
