from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

W = H = 1080
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "smartstore-ai-reply-ad-backlog.png"
FONT = r"C:\Windows\Fonts\malgun.ttf"
BOLD = r"C:\Windows\Fonts\malgunbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def centered(draw, y, text, f, fill):
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((W - (box[2] - box[0])) / 2, y), text, font=f, fill=fill)


def rounded_panel(image, box, radius=24, fill="#ffffff", outline="#e2e8f0"):
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    x1, y1, x2, y2 = box
    sd.rounded_rectangle((x1, y1 + 7, x2, y2 + 7), radius, fill=(15, 23, 42, 24))
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(image)
    d.rounded_rectangle(box, radius, fill=fill, outline=outline, width=2)


def check(draw, cx, cy):
    draw.ellipse((cx - 19, cy - 19, cx + 19, cy + 19), fill="#03b957")
    draw.line((cx - 9, cy, cx - 2, cy + 7), fill="white", width=5)
    draw.line((cx - 2, cy + 7, cx + 11, cy - 9), fill="white", width=5)


img = Image.new("RGBA", (W, H), "#f8fafc")
draw = ImageDraw.Draw(img)

draw.ellipse((72, 69, 86, 83), fill="#03c75a")
draw.text((98, 63), "\uc2a4\ub9c8\ud2b8\uc2a4\ud1a0\uc5b4 AI \uc790\ub3d9\ub2f5\uae00", font=font(17, True), fill="#334155")

centered(draw, 105, "\ub538\uae4d \ud55c \ubc88,", font(49, True), "#111827")
centered(draw, 164, "\ubc00\ub9b0 \ub9ac\ubdf0 \ub2f5\uae00 \ubaa8\ub450 \uc644\ub8cc", font(53, True), "#111827")
centered(draw, 238, "\ubcf5\ubd99 \uc5c6\uc774 \ub9ac\ubdf0\ub9c8\ub2e4 \ub2e4\ub974\uac8c, \ub0b4 \ub9d0\ud22c\ub85c \uc790\ub3d9 \uc0dd\uc131", font(22, True), "#475569")

left = (70, 305, 490, 782)
right = (590, 305, 1010, 782)
rounded_panel(img, left)
rounded_panel(img, right, outline="#b9ead0")
draw = ImageDraw.Draw(img)

draw.text((151, 344), "\ub611\uac19\uc740 \ubcf5\ubd99 \ub2f5\uae00", font=font(22, True), fill="#334155")
draw.text((684, 344), "\ub0b4 \ub9d0\ud22c \uc0dd\uc131 \ub2f5\ubcc0", font=font(22, True), fill="#087842")

generic = [
    "\uc548\ub155\ud558\uc138\uc694, \uace0\uac1d\ub2d8.",
    "\uc774\uc6a9\ud574 \uc8fc\uc154\uc11c \uac10\uc0ac\ud569\ub2c8\ub2e4.",
]
for y in (410, 590):
    draw.rounded_rectangle((101, y, 439, y + 126), 18, fill="#eef1f4")
    draw.text((126, y + 35), generic[0], font=font(18, True), fill="#334155")
    draw.text((126, y + 69), generic[1], font=font(18, True), fill="#334155")
    draw.ellipse((445, y + 43, 485, y + 83), fill="#f97316")
    draw.text((459, y + 47), "!", font=font(24, True), fill="white")

cards = [
    (
        "\uccab \uad6c\ub9e4 \uac10\uc0ac \ub9ac\ubdf0",
        "\uccab \uad6c\ub9e4\ub77c\ub2c8 \uc800\ud76c\ub3c4 \uc601\uad11\uc785\ub2c8\ub2e4!",
        "\ubbff\uace0 \uc120\ud0dd\ud574 \uc8fc\uc154\uc11c \uac10\uc0ac\ud574\uc694.",
    ),
    (
        "\uc0ac\uc6a9\uac10 \ub9cc\uc871 \ub9ac\ubdf0",
        "\uc21c\ud55c \uc0ac\uc6a9\uac10\uc744 \uc54c\uc544\ubd10 \uc8fc\uc168\ub124\uc694.",
        "\ud3b8\uc548\ud55c \ud558\ub8e8\uc5d0 \ub3c4\uc6c0\uc774 \ub418\uae38 \ubc14\ub77c\uc694.",
    ),
    (
        "\ube60\ub978 \ubc30\uc1a1 \ub9ac\ubdf0",
        "\uae30\ub2e4\ub9ac\uc9c0 \uc54a\uac8c \ub3c4\ucc29\ud574 \ub2e4\ud589\uc774\uc5d0\uc694!",
        "\ub2e4\uc74c\uc5d0\ub3c4 \uaf3c\uaf3c\ud788 \ubcf4\ub0b4\ub4dc\ub9b4\uac8c\uc694.",
    ),
]
for y, (title, line1, line2) in zip((395, 575), cards[:2]):
    draw.rounded_rectangle((618, y, 972, y + 136), 18, fill="white", outline="#dbe5df", width=2)
    draw.text((642, y + 22), title, font=font(19, True), fill="#087842")
    draw.text((642, y + 61), line1, font=font(16, True), fill="#1f2937")
    draw.text((642, y + 91), line2, font=font(16, True), fill="#1f2937")
    check(draw, 984, y + 68)

draw.rounded_rectangle((210, 842, 870, 944), 22, fill="#038a45")
centered(draw, 872, "\ubb34\ub8cc\ub85c 10\uac74 \uc368\ubcf4\uae30", font(35, True), "white")
centered(draw, 1000, "\ub9d0\ud22c \ubd84\uc11d 1\ud68c \ud3ec\ud568  \u00b7  \uce74\ub4dc \ub4f1\ub85d \uc5c6\uc74c", font(20, True), "#475569")

img.convert("RGB").save(OUT, quality=96)
print(OUT)
