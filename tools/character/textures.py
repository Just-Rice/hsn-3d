"""Converts a Rocketbox avatar's TGA textures for the game (run before retarget.py).

    python3 tools/character/textures.py <Textures dir> <out dir> [size]

Rocketbox ships color, normal and a grayscale specular map per material. Roughness is
derived from the specular map (shiny spots are smooth) and packed into the green channel,
the way glTF expects. Hair cards' opacity goes into the head color's alpha.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

src, out = sys.argv[1:3]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
os.makedirs(out, exist_ok=True)
for cpath in sorted(glob.glob(os.path.join(src, '*_color.tga'))):
    stem = os.path.basename(cpath)[:-len('_color.tga')]  # m022_body
    if stem.endswith('opacity'):
        continue
    R = lambda im: im.resize((size, size), Image.LANCZOS)
    col = R(Image.open(cpath).convert('RGB'))
    op = os.path.join(src, stem.split('_')[0] + '_opacity_color.tga')
    alpha = os.path.exists(op) and stem.endswith('head')
    if alpha:
        col = col.convert('RGBA')
        col.putalpha(R(Image.open(op).convert('L')))
        col.save(os.path.join(out, stem + '_color.png'), optimize=True)
    else:
        col.save(os.path.join(out, stem + '_color.jpg'), quality=88)
    R2 = lambda im: im.resize((size // 2, size // 2), Image.LANCZOS)  # normal and roughness at half size
    R2(Image.open(os.path.join(src, stem + '_normal.tga')).convert('RGB')).save(os.path.join(out, stem + '_normal.jpg'), quality=90)
    spec = np.asarray(R2(Image.open(os.path.join(src, stem + '_specular.tga')).convert('L')), dtype=np.float32) / 255
    rough = np.clip(0.9 - spec * 1.1, 0.32, 0.95)
    orm = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)
    Image.fromarray((orm * 255).astype(np.uint8)).save(os.path.join(out, stem + '_orm.jpg'), quality=90)
    print(stem, 'alpha' if alpha else '')
