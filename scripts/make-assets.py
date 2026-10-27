from PIL import Image, ImageDraw
import math, os

SS = 8  # supersample

def orb(size, ticks=True, pad=0.0):
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    r = S / 2 * (1 - pad)
    # simple vertical gradient sphere approximated with concentric circles
    for i in range(int(r), 0, -1):
        t = i / r
        # dark ball with lighter top-left
        v = int(8 + 70 * (1 - t) ** 2)
        col = (v, v + 1, v + 3, 255)
        d.ellipse([c - i, c - i, c + i, c + i], fill=col)
    # soft top-left highlight
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hx, hy = c - r * 0.34, c - r * 0.40
    for i in range(int(r * 0.5), 0, -1):
        a = int(26 * (1 - i / (r * 0.5)) ** 1.6)
        hd.ellipse([hx - i, hy - i * 0.7, hx + i, hy + i * 0.7], fill=(255, 255, 255, a))
    im = Image.alpha_composite(im, hl)
    if ticks:
        d = ImageDraw.Draw(im)
        L = r * 0.30
        W = r * 0.13
        for side in (-1, 1):
            ex = c + side * r * 0.32
            ey = c - r * 0.30
            # rotated rounded bar
            ang = math.radians(14)
            dx, dy = math.sin(ang), math.cos(ang)
            px, py = -dy, dx
            # polygon outline of capsule
            pts = []
            for t in (-0.5, 0.5):
                bx, by = ex + dx * L * t, ey + dy * L * t
                for s in (1, -1):
                    pts.append((bx + s * px * W / 2, by + s * py * W / 2))
            # capture both ends properly by drawing thick line
            p0 = (ex - dx * L / 2, ey - dy * L / 2)
            p1 = (ex + dx * L / 2, ey + dy * L / 2)
            d.line([p0, p1], fill=(255, 255, 255, 255), width=int(W), joint='curve')
            d.ellipse([p0[0] - W / 2, p0[1] - W / 2, p0[0] + W / 2, p0[1] + W / 2], fill=(255, 255, 255, 255))
            d.ellipse([p1[0] - W / 2, p1[1] - W / 2, p1[0] + W / 2, p1[1] + W / 2], fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)

# --- tray template (monochrome alpha) ---
for size, name in [(22, 'trayTemplate.png'), (44, 'trayTemplate@2x.png')]:
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    r = S / 2 * 0.92
    d.ellipse([c - r, c - r, c + r, c + r], fill=(0, 0, 0, 255))
    # transparent eye slots
    L = r * 0.62
    W = r * 0.20
    for side in (-1, 1):
        ex = c + side * r * 0.30
        ey = c - r * 0.28
        ang = math.radians(14)
        dx, dy = math.sin(ang), math.cos(ang)
        p0 = (ex - dx * L / 2, ey - dy * L / 2)
        p1 = (ex + dx * L / 2, ey + dy * L / 2)
        d.line([p0, p1], fill=(0, 0, 0, 0), width=int(W), joint='curve')
        d.ellipse([p0[0] - W / 2, p0[1] - W / 2, p0[0] + W / 2, p0[1] + W / 2], fill=(0, 0, 0, 0))
        d.ellipse([p1[0] - W / 2, p1[1] - W / 2, p1[0] + W / 2, p1[1] + W / 2], fill=(0, 0, 0, 0))
    im.resize((size, size), Image.LANCZOS).save(os.path.join('assets', name))

# --- app icon ---
base = orb(1024, True, pad=0.06)
base.save(os.path.join('assets', 'icon-1024.png'))
base.resize((512, 512), Image.LANCZOS).save(os.path.join('assets', 'icon-512.png'))
print('assets written')
