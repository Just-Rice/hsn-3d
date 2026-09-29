"""Bakes the building's lightmaps with Blender Cycles.

    blender -b -P tools/bake/bake.py -- tools/bake/out lightmaps 64
    (or, with the bpy module from PyPI:  python tools/bake/bake.py tools/bake/out lightmaps 64)

Reads scene.json / scene.bin from tools/bake/export.mjs. Three light sources are baked
separately and saved raw next to the scene (so encode.py can rebalance them later):
  fixtures  every ceiling light: direct + bounced
  sky       daylight through the windows and doors: direct + bounced
  sun       bounced light only (the game draws direct sunlight in real time, with shadows)
then encode.py writes lightmaps/page*.jpg and manifest.json.
Units match the game's: the sun is 3.1 and one fixture puts about 1.5 on the floor below it.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC = argv[0] if len(argv) > 0 else 'tools/bake/out'
OUT = argv[1] if len(argv) > 1 else 'lightmaps'
SAMPLES = int(argv[2]) if len(argv) > 2 else 128
SUN = 3.1
FIXTURE_FLOOR_E = 1.5  # irradiance under a fixture, in the game's units

meta = json.load(open(os.path.join(SRC, 'scene.json')))
blob = open(os.path.join(SRC, 'scene.bin'), 'rb').read()
LMI = meta['lightmap']
SIZE, PAD, PAGES = LMI['size'], LMI['pad'], LMI['pages']
t0 = time.time()


def log(*a):
    print(f'[{time.time() - t0:7.1f}s]', *a, flush=True)


def arr(off, n, dtype):
    return np.frombuffer(blob, dtype=dtype, count=n, offset=off)


def to_blender(p):  # three.js (x, y up, z) -> Blender (x, -z, z up)
    p = p.reshape(-1, 3)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 0
scene.cycles.transmission_bounces = 0
scene.cycles.transparent_max_bounces = 0
scene.cycles.use_light_tree = True
scene.render.bake.margin = PAD
scene.render.bake.margin_type = 'EXTEND'
scene.render.threads_mode = 'AUTO'

# ------------------------------------------------------------------ images, materials
pages = []
for p in range(PAGES):
    img = bpy.data.images.new(f'lm{p}', SIZE, SIZE, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    pages.append(img)


def make_material(name, albedo, has_col, page):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    rgb = nt.nodes.new('ShaderNodeRGB')
    rgb.outputs[0].default_value = (*[min(0.9, max(0.02, c)) for c in albedo], 1)
    if has_col:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(rgb.outputs[0], mix.inputs[6])
        nt.links.new(attr.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        nt.links.new(rgb.outputs[0], bsdf.inputs['Base Color'])
    if page is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = pages[page]
        nt.nodes.active = tex
    return mat


# ------------------------------------------------------------------ meshes
baked_objs = []
for i, m in enumerate(meta['meshes']):
    nv, nt_ = m['verts'], m['tris']
    pos = to_blender(arr(m['pos'], nv * 3, np.float32))
    idx = arr(m['idx'], nt_ * 3, np.uint32).astype(np.int32)
    me = bpy.data.meshes.new(f"{i}_{m['name']}")
    me.vertices.add(nv)
    me.vertices.foreach_set('co', pos.astype(np.float32).ravel())
    me.loops.add(nt_ * 3)
    me.loops.foreach_set('vertex_index', idx)
    me.polygons.add(nt_)
    me.polygons.foreach_set('loop_start', np.arange(0, nt_ * 3, 3, dtype=np.int32))
    col = arr(m['col'], nv * 3, np.float32).reshape(-1, 3)
    has_col = bool(np.any(np.abs(col - 1) > 1e-3))
    if has_col:
        ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        rgba = np.concatenate([col, np.ones((nv, 1), np.float32)], axis=1)
        ca.data.foreach_set('color', rgba.ravel())
    if m['uv1'] is not None:
        uv = arr(m['uv1'], nv * 2, np.float32).reshape(-1, 2)
        layer = me.uv_layers.new(name='lm')
        layer.data.foreach_set('uv', uv[idx].ravel())
    me.update(calc_edges=True)
    ob = bpy.data.objects.new(me.name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(make_material(me.name, m['albedo'], has_col, m['page']))
    if m['page'] is not None:
        baked_objs.append(ob)
log(f"built {len(meta['meshes'])} meshes, {len(baked_objs)} lightmapped")

# ground outside the building (grass and pavement bounce light in through the windows)
x0, z0, x1, z1 = meta['region']
bpy.ops.mesh.primitive_plane_add(size=1, location=((x0 + x1) / 2, -(z0 + z1) / 2, -0.005))
ground = bpy.context.object
ground.scale = (x1 - x0 + 200, z1 - z0 + 200, 1)
ground.data.materials.append(make_material('ground', [0.09, 0.11, 0.07], False, None))

# ------------------------------------------------------------------ lights
fixtures = []
for x, y, z, floor in meta['fixtures']:
    h = max(2.2, y - floor)
    ld = bpy.data.lights.new('fx', 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = 0.6, 1.2
    # a Lambertian panel of power P puts P / (pi h^2) on the floor straight below it
    ld.energy = FIXTURE_FLOOR_E * math.pi * h * h
    ld.color = (1.0, 0.98, 0.94)
    ob = bpy.data.objects.new('fx', ld)
    ob.location = (x, -z, y - 0.04)
    scene.collection.objects.link(ob)
    fixtures.append(ob)

sx, sy, sz = meta['sunDir']
sun_dir = Vector((sx, -sz, sy)).normalized()
sd = bpy.data.lights.new('sun', 'SUN')
sd.energy = SUN
sd.angle = math.radians(0.6)
sd.color = (1.0, 0.95, 0.87)
sun = bpy.data.objects.new('sun', sd)
sun.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(sun)

# sky: a simple gradient that gives about the same diffuse light as the game's sky
world = bpy.data.worlds.new('sky')
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes['Background']
tc = wn.nodes.new('ShaderNodeTexCoord')
sep = wn.nodes.new('ShaderNodeSeparateXYZ')
ramp = wn.nodes.new('ShaderNodeValToRGB')
wn.links.new(tc.outputs['Generated'], sep.inputs[0])
wn.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
el = ramp.color_ramp.elements
el[0].position, el[0].color = 0.0, (0.34, 0.40, 0.46, 1)
el[1].position, el[1].color = 1.0, (0.12, 0.22, 0.45, 1)
wn.links.new(ramp.outputs['Color'], bg.inputs['Color'])
SKY = 1.0
bg.inputs['Strength'].default_value = SKY


# ------------------------------------------------------------------ bake
def bake(label, passes):
    for img in pages:
        img.pixels.foreach_set(np.zeros(SIZE * SIZE * 4, np.float32))
    bpy.ops.object.select_all(action='DESELECT')
    for ob in baked_objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = baked_objs[0]
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=PAD, use_clear=True)
    log(f'bake {label}: {time.time() - t:.0f}s')
    out = []
    for img in pages:
        a = np.empty(SIZE * SIZE * 4, np.float32)
        img.pixels.foreach_get(a)
        out.append(a.reshape(SIZE, SIZE, 4)[:, :, :3].copy())
    return out


# Each light source is baked on its own and saved raw, so encode.py can rebalance them
# without baking again.
def save(name, imgs):
    for p, a in enumerate(imgs):
        np.save(os.path.join(SRC, f'{name}{p}.npy'), a.astype(np.float16))


only = argv[3].split(',') if len(argv) > 3 else ['fixtures', 'sky', 'sun']
samples = {'fixtures': SAMPLES, 'sky': max(16, SAMPLES * 3 // 4), 'sun': max(16, SAMPLES // 2)}


def setup(which):
    sun.hide_render = which != 'sun'
    for ob in fixtures:
        ob.hide_render = which != 'fixtures'
    bg.inputs['Strength'].default_value = SKY if which == 'sky' else 0.0
    scene.cycles.samples = samples[which]


for which in only:
    setup(which)
    # the sun's direct light is drawn in real time (with shadows), so bake only its bounce
    save(which, bake(f'{which} @{samples[which]}spp', {'INDIRECT'} if which == 'sun' else {'DIRECT', 'INDIRECT'}))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import encode  # noqa: E402

encode.run(SRC, OUT, samples=samples)
