"""Renders Poly Haven tree models into sprites for crossed-billboard trees.

    python tools/bake/tree_sprites.py <models dir> assets/trees
    (models dir holds <name>/<name>_1k.gltf from polyhaven.com; needs bpy + Pillow)

Each tree is rendered from two sides (0 and 90 degrees), orthographic, on a transparent
background, lit by a soft sky and a high sun so it reads well from any direction in game.
Writes trees.webp (one row per tree, two views each) and trees.json.
"""
import json
import math
import os
import sys

import bpy  # noqa: I001 (bpy first: it puts addon_utils on the path)
import addon_utils
from mathutils import Vector

SRC, OUT = sys.argv[-2], sys.argv[-1]
TREES = ['island_tree_02', 'tree_small_02', 'fir_sapling_medium']
W = H = 768  # square cells, one per view
os.makedirs(OUT, exist_ok=True)
addon_utils.enable('io_scene_gltf2')
frames = []
for name in TREES:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable('io_scene_gltf2')
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name, f'{name}_1k.gltf'))
    objs = [o for o in sc.objects if o.type == 'MESH']

    def bounds(o):
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])

    # some models are a group of plants: keep the one around the tallest mesh
    tall = max(objs, key=lambda o: bounds(o)[1].z)
    tlo, thi = bounds(tall)
    tc = (tlo + thi) / 2
    keep = []
    for o in objs:
        lo_, hi_ = bounds(o)
        c = (lo_ + hi_) / 2
        if math.hypot(c.x - tc.x, c.y - tc.y) < max(1.5, (thi.z - tlo.z) * 0.3):
            keep.append(o)
        else:
            o.hide_render = True
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in keep:
        a_, b_ = bounds(o)
        lo = Vector(map(min, lo, a_)); hi = Vector(map(max, hi, b_))
    size = hi - lo
    height = size.z
    scale = max(height, size.x, size.y) * 1.04
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(35), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    sc.collection.objects.link(cam)
    sc.camera = cam
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    for k, ang in enumerate([0, 90]):
        a = math.radians(ang)
        d = max(size.x, size.y) * 2 + 10
        cam.location = (cx + math.sin(a) * d, cy - math.cos(a) * d, lo.z + scale / 2)
        cam.rotation_euler = (math.radians(90), 0, a)
        path = os.path.join(OUT, f'_{name}_{k}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append((name, k, path))
    frames[-1] = frames[-1] + ({'height': height, 'width': max(size.x, size.y), 'span': scale},)
    print(name, 'height', round(height, 2), 'width', round(max(size.x, size.y), 2), flush=True)

from PIL import Image  # noqa: E402
sheet = Image.new('RGBA', (W * 2, H * len(TREES)), (0, 0, 0, 0))
meta = []
for i, name in enumerate(TREES):
    info = None
    for k in range(2):
        f = next(fr for fr in frames if fr[0] == name and fr[1] == k)
        if len(f) > 3:
            info = f[3]
        im = Image.open(f[2]).convert('RGBA')
        # bleed leaf colors into the transparent border so mipmaps don't darken edges
        sheet.paste(im, (k * W, i * H))
        os.remove(f[2])
    meta.append({'name': name, 'row': i, **info})
sheet.save(os.path.join(OUT, 'trees.webp'), quality=82, method=6)
json.dump({'rows': len(TREES), 'trees': meta, 'source': 'Poly Haven models (CC0): ' + ', '.join(TREES)}, open(os.path.join(OUT, 'trees.json'), 'w'), indent=1)
print('wrote', os.path.getsize(os.path.join(OUT, 'trees.webp')), 'bytes')
