"""Keyless placeholder shot: drifting fog, glow and silhouettes in the series look.

Used by --visuals=procedural (test runs) so the whole pipeline can run without a Gemini key.
usage: python3 procedural_shot.py OUT.mp4 SECONDS SEED THEME
THEME: room | forest | street | corridor | object
"""
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out, seconds, seed, theme = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
W, H, FPS = 540, 960, 30
rng = np.random.default_rng(seed)
n = int(round(seconds * FPS))


def fog_field(w, h, scale, blur):
    small = Image.fromarray((rng.random((max(2, h // scale), max(2, w // scale))) * 255).astype(np.uint8))
    big = small.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(big, dtype=np.float32) / 255.0
    return (a - a.min()) / (a.max() - a.min() + 1e-6)


def radial(cx, cy, r):
    y, x = np.mgrid[0:H, 0:W]
    d = np.sqrt(((x - cx) / r) ** 2 + ((y - cy) / r) ** 2)
    return np.clip(1 - d, 0, 1) ** 2


def pines(draw, base_y, count, h_min, h_max, color):
    xs = np.sort(rng.uniform(-40, W + 40, count))
    for x in xs:
        h = rng.uniform(h_min, h_max)
        w = h * rng.uniform(0.28, 0.4)
        for k in range(5):
            t = k / 5
            draw.polygon([(x, base_y - h + t * h * 0.8), (x - w * (0.35 + t * 0.65) / 2, base_y - h * (0.55 - t * 0.5)),
                          (x + w * (0.35 + t * 0.65) / 2, base_y - h * (0.55 - t * 0.5))], fill=color)
        draw.rectangle([x - 3, base_y - h * 0.08, x + 3, base_y], fill=color)


# ---- static layers per theme ----
bg = np.zeros((H, W, 3), np.float32)
sil = Image.new("L", (W, H), 0)  # silhouette mask (black shapes in front)
d = ImageDraw.Draw(sil)
glow_color = np.array([1.0, 0.12, 0.08])
glow = np.zeros((H, W), np.float32)
screen = None
grad = np.linspace(0, 1, H)[:, None]

if theme == "room":
    bg[:] = np.dstack([0.04 + 0.03 * grad, 0.05 + 0.03 * grad, 0.08 + 0.04 * grad])
    glow_color = np.array([0.35, 0.65, 1.0])
    glow = radial(W / 2, H * 0.52, W * 0.85)
    screen = (int(W * 0.24), int(H * 0.42), int(W * 0.76), int(H * 0.6))
    d.rectangle([0, int(H * 0.8), W, H], fill=255)  # floor shadow
    d.rectangle([int(W * 0.2), int(H * 0.38), int(W * 0.8), int(H * 0.41)], fill=255)  # TV top
    d.rectangle([int(W * 0.2), int(H * 0.61), int(W * 0.8), int(H * 0.68)], fill=255)  # TV base
    d.rectangle([int(W * 0.2), int(H * 0.38), int(W * 0.24), int(H * 0.68)], fill=255)
    d.rectangle([int(W * 0.76), int(H * 0.38), int(W * 0.8), int(H * 0.68)], fill=255)
elif theme == "street":
    bg[:] = np.dstack([0.55 + 0.25 * grad, 0.5 + 0.2 * grad, 0.48 + 0.12 * grad])
    glow_color = np.array([1.0, 0.85, 0.6])
    glow = radial(W * 0.7, H * 0.15, W) * 0.6
    y0 = int(H * 0.66)
    for i in range(-1, 5):
        x = i * W / 3.5 + 20
        d.polygon([(x, y0), (x + 70, y0 - 70), (x + 140, y0)], fill=170)
        d.rectangle([x + 10, y0, x + 130, y0 + 90], fill=170)
    d.rectangle([0, y0 + 90, W, H], fill=110)
elif theme == "corridor":
    bg[:] = np.dstack([0.03 + 0.02 * grad, 0.04 + 0.02 * grad, 0.05 + 0.02 * grad])
    cx, cy = W / 2, H * 0.45
    glow = radial(cx, cy, W * 0.6)
    d.polygon([(0, 0), (cx - 40, cy - 70), (cx - 40, cy + 70), (0, H)], fill=200)
    d.polygon([(W, 0), (cx + 40, cy - 70), (cx + 40, cy + 70), (W, H)], fill=200)
    d.rectangle([cx - 22, cy - 60, cx + 22, cy - 46], fill=0)
elif theme == "object":
    bg[:] = np.dstack([0.03 + 0.05 * grad, 0.05 + 0.06 * grad, 0.04 + 0.04 * grad])
    glow = radial(W / 2, H * 0.55, W * 0.7)
    glow_color = np.array([1.0, 0.25, 0.15])
    d.rectangle([0, int(H * 0.72), W, H], fill=150)
else:  # forest
    bg[:] = np.dstack([0.02 + 0.05 * grad, 0.03 + 0.04 * grad, 0.05 + 0.04 * grad])
    glow = radial(W / 2, H * 0.58, W * 0.9)
    pines(d, H * 0.82, 14, H * 0.25, H * 0.45, 140)
    pines(d, H * 0.95, 9, H * 0.4, H * 0.7, 255)

sil_a = np.asarray(sil.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[..., None] / 255.0
fog1 = fog_field(W * 2, H * 2, 60, 28)
fog2 = fog_field(W * 2, H * 2, 30, 14)
y, x = np.mgrid[0:H, 0:W]
vign = np.clip(1.15 - (((x - W / 2) / (W * 0.62)) ** 2 + ((y - H / 2) / (H * 0.62)) ** 2), 0.15, 1)[..., None]
fog_tint = np.array([0.55, 0.6, 0.7]) if theme != "street" else np.array([0.9, 0.88, 0.85])

ff = subprocess.Popen(
    ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
     "-r", str(FPS), "-i", "-", "-vf", "scale=1080:1920:flags=lanczos", "-c:v", "libx264", "-preset", "veryfast",
     "-crf", "18", "-pix_fmt", "yuv420p", out],
    stdin=subprocess.PIPE,
)
for f in range(n):
    t = f / FPS
    ox1, oy1 = int(W * 0.5 + 18 * t), int(H * 0.5 + 6 * t)
    ox2, oy2 = int(W * 0.3 - 30 * t) % W, int(H * 0.4 + 10 * t)
    fog = 0.6 * fog1[oy1:oy1 + H, ox1 % W:ox1 % W + W] + 0.4 * fog2[oy2:oy2 + H, ox2:ox2 + W]
    flicker = 0.85 + 0.15 * np.sin(t * 9 + seed) * np.sin(t * 2.3) + (0.25 if rng.random() < 0.02 else 0)
    frame = bg + glow[..., None] * glow_color * 0.9 * flicker
    if screen:
        x0, y0, x1, y1 = screen
        static = rng.random((y1 - y0, x1 - x0, 1)).astype(np.float32)
        frame[y0:y1, x0:x1] = 0.35 * static * np.array([0.6, 0.8, 1.0]) + 0.25 * np.array([0.3, 0.5, 0.9])
    frame = frame * (1 - sil_a * 0.95)
    frame = frame + (fog[..., None] ** 2.2) * fog_tint * (0.35 if theme != "street" else 0.25)
    if theme == "street" and rng.random() < 0.08:  # VHS glitch band
        r0 = rng.integers(0, H - 40)
        frame[r0:r0 + 30] = np.roll(frame[r0:r0 + 30], rng.integers(-30, 30), axis=1) * 1.1
    frame = frame * vign
    frame = frame + rng.normal(0, 0.025, (H, W, 1)).astype(np.float32)  # grain
    ff.stdin.write((np.clip(frame, 0, 1) * 255).astype(np.uint8).tobytes())
ff.stdin.close()
sys.exit(ff.wait())
