"""Combines the baked light sources into web lightmaps (page*.jpg + manifest.json).

    python tools/bake/encode.py tools/bake/out lightmaps [fixtures sky sun]

The optional weights rebalance the sources without baking again (defaults below).
Stored texel = (light / lmax) encoded as sRGB; the game multiplies by manifest.intensity.
Run with Blender's Python (or the bpy module) to denoise with OIDN; plain Python falls back
to a simple smoothing filter.
"""
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image

WEIGHTS = {'fixtures': 0.38, 'sky': 1.0, 'sun': 1.0}


def smooth(img, idm, passes=3):
    """Averages each texel with its 8 neighbors from the same quad (never across quads)."""
    for _ in range(passes):
        acc = img.copy()
        wsum = np.ones(idm.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sh = np.roll(np.roll(img, dy, 0), dx, 1)
                sid = np.roll(np.roll(idm, dy, 0), dx, 1)
                w = (sid == idm).astype(np.float32) * (0.5 if dx and dy else 1.0)
                acc += sh * w[..., None]
                wsum += w
        img = acc / wsum[..., None]
    return img


def oidn(img, idm, tmp):
    """Intel Open Image Denoise through Blender's compositor. Each quad gets its own flat
    color in the albedo guide, so the denoiser keeps quads apart. Returns None without bpy."""
    try:
        import bpy
    except ImportError:
        return None
    size = img.shape[0]
    rng = np.random.default_rng(1)
    pal = rng.random((int(idm.max()) + 2, 3)).astype(np.float32) * 0.8 + 0.1
    albedo = pal[idm]

    def image(name, arr):
        im = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
        im.pixels.foreach_set(np.concatenate([arr, np.ones((size, size, 1), np.float32)], axis=2).ravel())
        return im

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    ni = nt.nodes.new('CompositorNodeImage')
    ni.image = image('light', img)
    na = nt.nodes.new('CompositorNodeImage')
    na.image = image('guide', albedo)
    dn = nt.nodes.new('CompositorNodeDenoise')
    dn.use_hdr = True
    dn.prefilter = 'NONE'
    cp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(ni.outputs['Image'], dn.inputs['Image'])
    nt.links.new(na.outputs['Image'], dn.inputs['Albedo'])
    nt.links.new(dn.outputs['Image'], cp.inputs['Image'])
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.ops.render.render(write_still=False)
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    bpy.data.images['Render Result'].save_render(tmp)
    im = bpy.data.images.load(tmp)
    px = np.empty(size * size * 4, np.float32)
    im.pixels.foreach_get(px)
    os.remove(tmp)
    return px.reshape(size, size, 4)[:, :, :3].copy()


def run(src, out, weights=None, samples=None):
    w = {**WEIGHTS, **(weights or {})}
    old = os.path.join(out, 'manifest.json')
    if samples is None and os.path.exists(old):
        samples = json.load(open(old)).get('samples')
    meta = json.load(open(os.path.join(src, 'scene.json')))
    lm = meta['lightmap']
    size, pages = lm['size'], lm['pages']
    ids, lit = [], []
    for p in range(pages):
        idm = np.full((size, size), -1, np.int32)
        for k, (x, y, rw, rh) in enumerate(lm['rects'][p]):
            idm[y:y + rh, x:x + rw] = k
        ids.append(idm)
        L = np.zeros((size, size, 3), np.float32)
        for name, k in w.items():
            f = os.path.join(src, f'{name}{p}.npy')
            if k and os.path.exists(f):
                L += k * np.load(f).astype(np.float32)
        d = oidn(L, idm, os.path.join(src, f'denoise{p}.exr'))
        lit.append(np.maximum(d, 0) if d is not None else smooth(L, idm))
    valid = np.concatenate([L[ids[p] >= 0].reshape(-1, 3) for p, L in enumerate(lit)])
    lmax = float(np.clip(np.percentile(valid.max(axis=1), 99.5), 0.5, 4.0))
    os.makedirs(out, exist_ok=True)
    files = []
    for p, L in enumerate(lit):
        x = np.clip(L / lmax, 0, 1)
        srgb = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
        # Blender rows start at the bottom; image files start at the top
        im = Image.fromarray((np.flipud(srgb) * 255 + 0.5).astype(np.uint8), 'RGB')
        name = f'page{p}.jpg'
        im.save(os.path.join(out, name), quality=90, optimize=True)
        files.append(name)
    manifest = {
        'hash': lm['hash'],
        'pages': pages,
        'files': files,
        # a diffuse bake stores irradiance / pi; the game's lightMap wants irradiance
        'intensity': math.pi * lmax,
        'lmax': lmax,
        'weights': w,
        'samples': samples,
        'texel': lm['texel'],
        'denoiser': 'oidn' if 'bpy' in sys.modules else 'smooth',
        'baked': time.strftime('%Y-%m-%d'),
    }
    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    print('encoded', manifest, flush=True)
    return manifest


if __name__ == '__main__':
    a = sys.argv[1:]
    ws = dict(zip(['fixtures', 'sky', 'sun'], map(float, a[2:5]))) if len(a) > 2 else None
    run(a[0] if a else 'tools/bake/out', a[1] if len(a) > 1 else 'lightmaps', ws)
