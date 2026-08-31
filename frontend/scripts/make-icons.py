"""Write Compass PWA icons as PNG (no third-party deps)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public"

# Keep the mark inside the OS icon mask (about 70% of the old size).
SCALE = 0.70


def scaled(x: float, y: float) -> tuple[float, float]:
    return (0.5 + (x / 256 - 0.5) * SCALE, 0.5 + (y / 256 - 0.5) * SCALE)


NEEDLE = (
    scaled(177, 79),
    scaled(141, 145),
    scaled(79, 177),
    scaled(115, 111),
)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c0: tuple[int, int, int], c1: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(lerp(c0[0], c1[0], t)),
        int(lerp(c0[1], c1[1], t)),
        int(lerp(c0[2], c1[2], t)),
    )


def squircle_alpha(x: float, y: float, size: int) -> float:
    radius = size * 0.22
    px, py = x + 0.5, y + 0.5
    if radius <= px <= size - radius and radius <= py <= size - radius:
        return 1.0
    cx = min(max(px, radius), size - radius)
    cy = min(max(py, radius), size - radius)
    dist = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
    edge = radius - dist
    if edge >= 1:
        return 1.0
    if edge <= 0:
        return 0.0
    return edge


def inside_poly(px: float, py: float, pts: tuple[tuple[float, float], ...]) -> bool:
    inside = False
    j = len(pts) - 1
    for i, (xi, yi) in enumerate(pts):
        xj, yj = pts[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def pixel(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    t = (x + y) / (2 * (size - 1))
    if t < 0.5:
        color = mix((79, 57, 246), (152, 16, 250), t * 2)
    else:
        color = mix((152, 16, 250), (230, 0, 118), (t - 0.5) * 2)

    alpha = squircle_alpha(x, y, size)
    nx = (x + 0.5) / size
    ny = (y + 0.5) / size
    dx, dy = nx - 0.5, ny - 0.5
    dist = (dx * dx + dy * dy) ** 0.5

    ring_r = 84 / 256 * SCALE
    ring_half = 5 / 256
    hole_r = 9 / 256 * SCALE
    if abs(dist - ring_r) <= ring_half or inside_poly(nx, ny, NEEDLE) and dist >= hole_r:
        color = (255, 255, 255)

    return (*color, int(round(alpha * 255)))


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    compressed = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, size in (
        ("favicon.png", 32),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        dest = OUT / name
        write_png(dest, size)
        print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
