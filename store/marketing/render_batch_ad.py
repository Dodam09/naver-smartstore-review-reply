from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

W = H = 1080
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "smartstore-ai-reply-ad-batch.png"
FONT = r"C:\Windows\Fonts\malgun.ttf"
BOLD = r"C:\Windows\Fonts\malgunbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def center(draw, y, text, f, color):
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((W - box[2] + box[0]) / 2, y), text, font=f, fill=color)


def panel(image, box, outline="#e2e8f0"):
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    x1, y1, x2, y2 = box
    sd.rounded_rectangle((x1, y1 + 8, x2, y2 + 8), 24, fill=(15, 23, 42, 28))
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    ImageDraw.Draw(image).rounded_rectangle(box, 24, fill="white", outline=outline, width=2)


def arrow(draw, x, y):
    draw.line((x - 18, y, x + 18, y), fill="#94a3b8", width=5)
    draw.polygon(((x + 18, y), (x + 7, y - 9), (x + 7, y + 9)), fill="#94a3b8")


img = Image.new("RGBA", (W, H), "#f8fafc")
draw = ImageDraw.Draw(img)

draw.ellipse((70, 63, 84, 77), fill="#03c75a")
draw.text((96, 57), "\uc2a4\ub9c8\ud2b8\uc2a4\ud1a0\uc5b4 AI \uc790\ub3d9\ub2f5\uae00", font=font(17, True), fill="#334155")

center(draw, 116, "\uc544\uc9c1\ub3c4 \ub9ac\ubdf0 \ub2f5\uae00\uc744", font(53, True), "#111827")
center(draw, 181, "\ud558\ub098\uc529 \ubcf5\ubd99\ud558\uc138\uc694?", font(62, True), "#111827")
center(draw, 272, "\ub9ac\ubdf0\ub9cc \uace0\ub974\uba74 \ub0b4 \ub9d0\ud22c\ub85c \ub2f5\uae00\uc744 \ub9cc\ub4e4\uace0", font(25, True), "#475569")
center(draw, 311, "\ud310\ub9e4\uc790\uc13c\ud130 \uc5c5\ub85c\ub4dc\uae4c\uc9c0 \ud55c \ubc88\uc5d0", font(25, True), "#475569")

boxes = [(54, 398, 326, 744), (404, 398, 676, 744), (754, 398, 1026, 744)]
for box in boxes:
    panel(img, box)
draw = ImageDraw.Draw(img)

steps = [
    ("1", "\ub9ac\ubdf0 \uc120\ud0dd", "\ub2f5\uae00\uc744 \ub2ec \ub9ac\ubdf0\ub97c\n\uc5ec\ub7ec \uac74 \uace0\ub974\uc138\uc694"),
    ("2", "AI \ub2f5\uae00 \uc644\uc131", "\ub0b4 \uae30\uc874 \ub2f5\uae00 \ub9d0\ud22c\ub85c\n\uc790\uc5f0\uc2a4\ub7ec\uc6b4 \ucd08\uc548 \uc0dd\uc131"),
    ("3", "\ud55c \ubc88\uc5d0 \uc5c5\ub85c\ub4dc", "\ud655\uc778\ud55c \ub2f5\uae00\uc744\n\ud310\ub9e4\uc790\uc13c\ud130\uc5d0 \ub4f1\ub85d"),
]
for box, (n, title, body) in zip(boxes, steps):
    x1, y1, x2, y2 = box
    cx = (x1 + x2) // 2
    draw.ellipse((cx - 28, y1 + 34, cx + 28, y1 + 90), fill="#e9f9f0")
    num_box = draw.textbbox((0, 0), n, font=font(27, True))
    draw.text((cx - (num_box[2] - num_box[0]) / 2, y1 + 44), n, font=font(27, True), fill="#078542")
    title_box = draw.textbbox((0, 0), title, font=font(25, True))
    draw.text((cx - (title_box[2] - title_box[0]) / 2, y1 + 120), title, font=font(25, True), fill="#111827")
    body_lines = body.split("\n")
    for i, line in enumerate(body_lines):
        line_box = draw.textbbox((0, 0), line, font=font(18, True))
        draw.text((cx - (line_box[2] - line_box[0]) / 2, y1 + 168 + i * 31), line, font=font(18, True), fill="#64748b")

    if n == "1":
        for i in range(3):
            yy = y1 + 255 + i * 29
            draw.rounded_rectangle((x1 + 42, yy, x2 - 42, yy + 20), 8, fill="#edf2f7")
            draw.ellipse((x1 + 51, yy + 5, x1 + 61, yy + 15), fill="#03c75a")
    elif n == "2":
        draw.rounded_rectangle((x1 + 35, y1 + 249, x2 - 35, y1 + 326), 12, fill="#f4fbf7", outline="#b9ead0")
        draw.text((x1 + 53, y1 + 267), "\uc815\uc131\uc2a4\ub7ec\uc6b4 \ub2f5\uae00 \uc644\uc131", font=font(18, True), fill="#087842")
    else:
        draw.rounded_rectangle((x1 + 38, y1 + 258, x2 - 38, y1 + 317), 14, fill="#078542")
        label = "\ub2f5\ubcc0 \uc644\ub8cc"
        lb = draw.textbbox((0, 0), label, font=font(19, True))
        draw.text((cx - (lb[2] - lb[0]) / 2, y1 + 274), label, font=font(19, True), fill="white")

arrow(draw, 365, 572)
arrow(draw, 715, 572)

draw.rounded_rectangle((183, 786, 897, 846), 30, fill="#ecfdf3")
center(draw, 799, "\uc791\uc131\ubd80\ud130 \uc5c5\ub85c\ub4dc\uae4c\uc9c0, \uba87 \ubc88\uc758 \ud074\ub9ad\uc73c\ub85c", font(23, True), "#087842")

draw.rounded_rectangle((208, 876, 872, 974), 22, fill="#038a45")
center(draw, 903, "\ubb34\ub8cc\ub85c 10\uac74 \uc368\ubcf4\uae30", font(35, True), "white")
center(draw, 1014, "\ub9d0\ud22c \ubd84\uc11d 1\ud68c \ud3ec\ud568  \u00b7  \uce74\ub4dc \ub4f1\ub85d \uc5c6\uc74c", font(20, True), "#475569")

img.convert("RGB").save(OUT, quality=96)
print(OUT)
