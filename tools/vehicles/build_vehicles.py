"""Models the cars, trucks and school buses in the lots and exports assets/models/vehicles.glb.

    blender -b -P tools/vehicles/build_vehicles.py -- <ambientCG sets dir> <out.glb> [preview dir]

Every body is lofted from a few numbers: a side profile (the height of the top of the body
along its length: bumper, hood, windshield, roof, back glass, trunk), the plan width, the
beltline and how much the greenhouse leans in. Each cross-section runs from the underside
out to the rocker, up the door to the beltline, in along the side glass and across the
roof. Faces are then sorted into paint, glass, lights, grille and lower trim by where they
sit, the wheel arches are cut with Booleans and lined, and wheels (tire, five-spoke rim,
center cap) go in. Paint is a clearcoat material the game tints per car; everything else
keeps its color (materials named "*_fixed"). The front of every vehicle is at Blender -Y,
the game's +Z. Origins are on the ground at the middle of the wheelbase.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SETS, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None


def log(*a):
    print('[vehicles]', *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, rough, metal=0.0, coat=0.0, emit=None, emit_strength=0.0, tex=None, tile=1.0, fixed=True, alpha=1.0):
    m = bpy.data.materials.new(name + ('_fixed' if fixed else ''))
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.03
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    if tex:
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        for kind, sock, color_space in (('Color', 'Base Color', 'sRGB'), ('Roughness', 'Roughness', 'Non-Color'), ('NormalGL', None, 'Non-Color')):
            p = os.path.join(SETS, tex, f'{tex}_1K-JPG_{kind}.jpg')
            if not os.path.exists(p):
                continue
            im = bpy.data.images.load(p, check_existing=True)
            im.colorspace_settings.name = color_space
            if im.size[0] > 512:
                im.scale(512, 512)
                im.filepath_raw = os.path.join(bpy.app.tempdir, kind + '_' + os.path.basename(p))
                im.file_format = 'JPEG'
                im.save()
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = im
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
            if sock == 'Base Color':
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1
                mix.inputs[7].default_value = (*color, 1)
                nt.links.new(n.outputs['Color'], mix.inputs[6])
                nt.links.new(mix.outputs[2], b.inputs['Base Color'])
            elif sock:
                nt.links.new(n.outputs['Color'], b.inputs[sock])
            else:
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nt.links.new(n.outputs['Color'], nm.inputs['Color'])
                nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


M = dict(
    paint=mat('carpaint', (0.85, 0.85, 0.85), 0.32, metal=0.35, coat=1.0, fixed=False),  # tinted per car
    yellow=mat('busyellow', (0.85, 0.52, 0.02), 0.35, coat=0.6),
    white=mat('truckwhite', (0.86, 0.86, 0.84), 0.35, coat=0.6),
    glass=mat('carglass', (0.02, 0.025, 0.03), 0.04, metal=0.0),
    trim=mat('blacktrim', (0.025, 0.025, 0.027), 0.55),
    grille=mat('grille', (0.02, 0.02, 0.02), 0.4, metal=0.5),
    chrome=mat('chrome', (0.9, 0.9, 0.92), 0.08, metal=1.0),
    head=mat('headlight', (0.8, 0.82, 0.85), 0.05, metal=0.6, emit=(1, 0.97, 0.9), emit_strength=0.3),
    tail=mat('taillight', (0.45, 0.02, 0.02), 0.1, emit=(1, 0.05, 0.03), emit_strength=0.4),
    amber=mat('amber', (0.8, 0.4, 0.02), 0.1, emit=(1, 0.5, 0.05), emit_strength=0.3),
    tire=mat('tire', (0.22, 0.22, 0.22), 0.85, tex='Rubber004', tile=0.15),
    rim=mat('rim', (0.7, 0.71, 0.73), 0.25, metal=1.0),
    liner=mat('liner', (0.015, 0.015, 0.015), 0.9),
    plate=mat('plate', (0.92, 0.92, 0.9), 0.4),
)


class V:
    """A vehicle recipe. t runs 0 (front) to 1 (rear) along the length."""

    def __init__(self, name, L, W, wheel_r, wheels, top, belt, low, ws, rw, roof_in=0.13, paint='paint', front_flat=0.0,
                 rear_flat=0.0, windows=None, pillars=(), bed=None, wheel_w=0.21, plan_round=0.12):
        self.__dict__.update(locals())


def interp(pts, t):
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 0
            u = u * u * (3 - 2 * u)
            return v0 + (v1 - v0) * u
    return pts[-1][1]


def body(v):
    NS = 48  # stations along the length
    ring = []  # (segment, s) per half; segments: 0 bottom, 1 side, 2 glass side, 3 roof
    for i in range(3):
        ring.append((0, i / 3))
    for i in range(8):
        ring.append((1, i / 8))
    for i in range(6):
        ring.append((2, i / 6))
    for i in range(8):
        ring.append((3, i / 7))
    bm = bmesh.new()
    grid = []
    info = []  # per (station, ring index): segment

    def half_width(t):
        # plan view: full width in the middle, rounded at both ends
        e = min(t, 1 - t) * v.L
        r = v.plan_round * v.L * 0.5
        if e >= r:
            return v.W / 2
        k = e / r
        return v.W / 2 * (0.82 + 0.18 * math.sqrt(max(0, 1 - (1 - k) ** 2)))

    for si in range(NS + 1):
        t = si / NS
        y = -v.L / 2 + t * v.L  # front at -Y
        w = half_width(t)
        zt = interp(v.top, t)
        zb = min(interp(v.belt, t), zt - 0.005)
        zl = interp(v.low, t)
        roof_w = max(0.05, w - v.roof_in * min(1, (zt - zb) / 0.35))
        pts = []
        for seg, s in ring:
            if seg == 0:
                x, z = s * (w - 0.08), zl
            elif seg == 1:
                z = zl + 0.06 + s * (zb - zl - 0.06)
                bulge = 0.025 * math.sin(math.pi * s)
                x = w - 0.06 * (1 - s) ** 3 + bulge - 0.02
                if s == 0:
                    x, z = w - 0.08, zl + 0.015
            elif seg == 2:
                z = zb + s * (zt - zb - 0.03)
                x = (w - 0.02) + (roof_w - (w - 0.02)) * s
            else:
                x = roof_w * (1 - s)
                s = min(1.0, s)
                z = zt - 0.03 + 0.03 * math.sin(math.pi / 2 * min(1, s * 2.5)) + 0.012 * (1 - (1 - s) ** 2)
            pts.append((x, y, z))
        row = []
        for x, yy, z in pts:  # right half (x > 0) bottom center -> roof center
            row.append((x, yy, z))
        full = [(-x, yy, z) for (x, yy, z) in reversed(row[1:-1])] + row
        grid.append([bm.verts.new(p) for p in full])
        info.append([ring[0][0]] * 0 + [s for s, _ in reversed(ring[1:-1])] + [s for s, _ in ring])
    n = len(grid[0])
    faces = []
    for si in range(NS):
        for j in range(n):
            a, b = grid[si][j], grid[si][(j + 1) % n]
            c, d = grid[si + 1][(j + 1) % n], grid[si + 1][j]
            f = bm.faces.new((a, d, c, b))
            faces.append((f, si, j))
    # caps
    bm.faces.new(list(reversed(grid[0])))
    bm.faces.new(grid[-1])
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(v.name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(v.name, me)
    scene.collection.objects.link(ob)
    # materials by position
    slots = ['paint', 'glass', 'trim', 'grille', 'head', 'tail', 'liner', 'chrome', 'amber', 'plate']
    for sname in slots:
        ob.data.materials.append(M[v.paint] if sname == 'paint' else M[sname])
    idx = {s: i for i, s in enumerate(slots)}
    for p in ob.data.polygons:
        c = p.center
        t = (c.y + v.L / 2) / v.L
        zb = interp(v.belt, t)
        zt = interp(v.top, t)
        zl = interp(v.low, t)
        nrm = p.normal
        m = 'paint'
        ax = abs(c.x)
        w = v.W / 2
        if c.z < zl + 0.07 or nrm.z < -0.6:
            m = 'trim'
        # glass: windshield and back glass on the roof band, side glass on the greenhouse
        if v.windows:
            for (a, b, kind) in v.windows:
                if a <= t <= b:
                    inner = a + 0.008 <= t <= b - 0.008
                    # windshield / back glass: sloped faces above the belt, not the flanks
                    if kind == 'top' and inner and c.z > zb + 0.05 and abs(nrm.x) < 0.55 and nrm.z < 0.93 and ax < w - 0.06:
                        m = 'glass'
                    if kind == 'side' and inner and zb + 0.04 < c.z < zt - 0.07 and abs(nrm.x) > 0.45 and not any(p0 <= t <= p1 for p0, p1 in v.pillars):
                        m = 'glass'
                    if kind == 'band' and v.win_band[0] < c.z < v.win_band[1] and abs(nrm.x) > 0.5 and not any(p0 <= t <= p1 for p0, p1 in v.pillars):
                        m = 'glass'
                    if kind == 'flat' and v.win_band[0] < c.z < v.win_band[1] + 0.25 and abs(nrm.y) > 0.6:
                        m = 'glass'
        p.material_index = idx[m]
    return ob


def wheel_arches(ob, v):
    # cut each arch with a cylinder a bit larger than the tire, then line it
    cutters = []
    for (y, side) in v.wheels:
        bpy.ops.mesh.primitive_cylinder_add(radius=v.wheel_r + 0.06, depth=0.8, vertices=32, location=(side * (v.W / 2), y, v.wheel_r + 0.02), rotation=(0, math.pi / 2, 0))
        cutters.append(bpy.context.object)
    for c in cutters:
        mod = ob.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for c in cutters:
        bpy.data.objects.remove(c)
    li = list(m.name for m in ob.data.materials).index('liner_fixed')
    for p in ob.data.polygons:
        for (y, side) in v.wheels:
            d = math.hypot(p.center.y - y, p.center.z - v.wheel_r - 0.02)
            if abs(d - (v.wheel_r + 0.06)) < 0.03 and abs(p.center.x) < v.W / 2 + 0.05 and abs(p.normal.x) < 0.7:
                p.material_index = li


def wheel(x, y, r, width, side):
    # tire: a rounded cylinder; rim: dish with five spokes; cap
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=width, vertices=20, location=(x, y, r), rotation=(0, math.pi / 2, 0))
    tire = bpy.context.object
    bev = tire.modifiers.new('b', 'BEVEL')
    bev.width = 0.045
    bev.segments = 2
    bpy.ops.object.modifier_apply(modifier=bev.name)
    tire.data.materials.append(M['tire'])
    parts.append(tire)
    face = x + side * (width / 2 - 0.02)
    bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.66, depth=0.03, vertices=20, location=(face, y, r), rotation=(0, math.pi / 2, 0))
    rim = bpy.context.object
    rim.data.materials.append(M['rim'])
    parts.append(rim)
    bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.5, depth=0.04, vertices=16, location=(face + side * 0.01, y, r), rotation=(0, math.pi / 2, 0))
    well = bpy.context.object
    well.data.materials.append(M['liner'])
    parts.append(well)
    for k in range(5):
        a = k * 2 * math.pi / 5
        bpy.ops.mesh.primitive_cube_add(size=1, location=(face + side * 0.02, y + math.cos(a) * r * 0.27, r + math.sin(a) * r * 0.27), rotation=(a, 0, 0))
        sp = bpy.context.object
        sp.scale = (0.03, r * 0.5, 0.05)
        sp.data.materials.append(M['rim'])
        parts.append(sp)
    bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.13, depth=0.05, vertices=16, location=(face + side * 0.03, y, r), rotation=(0, math.pi / 2, 0))
    cap = bpy.context.object
    cap.data.materials.append(M['chrome'])
    parts.append(cap)
    return parts


def mirrors(v, y, z):
    parts = []
    for side in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(side * (v.W / 2 + 0.08), y, z))
        o = bpy.context.object
        o.scale = (0.16, 0.07, 0.12)
        bev = o.modifiers.new('b', 'BEVEL')
        bev.width = 0.025
        bev.segments = 2
        bpy.ops.object.modifier_apply(modifier=bev.name)
        o.data.materials.append(M[v.paint])
        parts.append(o)
    return parts


def details(ob, v):
    """Lights, grille, plates, handles and door seams, placed on the body by ray casting
    so each one sits flush on the curved surface, turned to its normal."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(ob, dg)
    parts = []
    w = v.W / 2
    hz0, hz1 = v.lights

    def stick(origin, direction, sx, sz, depth, material, bevel=0.01, proud=0.004):
        hit, nrm, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized(), 20)
        if hit is None:
            return
        bpy.ops.mesh.primitive_cube_add(size=1, location=hit + nrm * (proud - depth / 2 + depth / 2))
        o = bpy.context.object
        o.scale = (sx, depth, sz)
        if bevel:
            b = o.modifiers.new('b', 'BEVEL')
            b.width = min(bevel, sx / 2.1, sz / 2.1, depth / 2.1)
            b.segments = 2
            bpy.ops.object.modifier_apply(modifier=b.name)
        # local -Y (the box's depth axis) faces along the surface normal
        q = Vector((0, -1, 0)).rotation_difference(nrm)
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = q
        o.data.materials.append(M[material])
        parts.append(o)

    front, rear = Vector((0, 1, 0)), Vector((0, -1, 0))
    yF, yR = -v.L / 2 - 1, v.L / 2 + 1
    hh = hz1 - hz0
    for side in (-1, 1):
        # headlight cluster: chrome reflector housing with a clear lens over it
        stick((side * (w - 0.24), yF, (hz0 + hz1) / 2), front, 0.36, hh, 0.04, 'chrome', 0.02)
        stick((side * (w - 0.24), yF, (hz0 + hz1) / 2), front, 0.37, hh + 0.01, 0.03, 'head', 0.02, 0.012)
        stick((side * (w - 0.2), yF, hz0 - 0.22), front, 0.16, 0.05, 0.03, 'amber', 0.01)
        # tail lights wrap a little onto the corner
        stick((side * (w - 0.22), yR, (hz0 + hz1) / 2), rear, 0.38, hh, 0.04, 'tail', 0.02)
    # grille and lower intake
    stick((0, yF, hz0 - 0.02), front, 2 * (w - 0.5), hh * 0.85 + 0.06, 0.03, 'grille', 0.02)
    stick((0, yF, hz0 - 0.32), front, 2 * (w - 0.4), 0.12, 0.03, 'trim', 0.03)
    # plates
    stick((0, yF, hz0 - 0.2), front, 0.31, 0.155, 0.012, 'plate', 0.006, 0.01)
    stick((0, yR, hz0 - 0.15), rear, 0.31, 0.155, 0.012, 'plate', 0.006)
    stick((0, yR, hz0 - 0.35), rear, 2 * (w - 0.2), 0.08, 0.03, 'trim', 0.03)
    # door handles and seams along both sides
    zb = interp(v.belt, 0.5)
    for side in (-1, 1):
        for t in v.doors:
            y = -v.L / 2 + t * v.L
            # seam: a dark hairline from the sill to the beltline
            hit, nrm, _, _ = tree.ray_cast(Vector((side * (w + 1), y, (zb + interp(v.low, t)) / 2)), Vector((-side, 0, 0)), 20)
            if hit is not None:
                bpy.ops.mesh.primitive_cube_add(size=1, location=hit + nrm * 0.001)
                c = bpy.context.object
                c.scale = (0.004, 0.006, zb - interp(v.low, t) - 0.12)
                c.data.materials.append(M['liner'])
                parts.append(c)
        for t in v.handles:
            y = -v.L / 2 + t * v.L
            hit, nrm, _, _ = tree.ray_cast(Vector((side * (w + 1), y, zb - 0.1)), Vector((-side, 0, 0)), 20)
            if hit is not None:
                bpy.ops.mesh.primitive_cube_add(size=1, location=hit + nrm * 0.012)
                c = bpy.context.object
                c.scale = (0.022, 0.16, 0.03)
                bv = c.modifiers.new('b', 'BEVEL')
                bv.width = 0.01
                bv.segments = 2
                bpy.ops.object.modifier_apply(modifier=bv.name)
                c.data.materials.append(M[v.paint])
                parts.append(c)
    return parts


def build(v, extra=None):
    ob = body(v)
    wheel_arches(ob, v)
    parts = [ob] + details(ob, v)
    for (y, side) in v.wheels:
        parts += wheel(side * (v.W / 2 - v.wheel_w / 2 - 0.03), y, v.wheel_r, v.wheel_w, side)
    if v.mirror:
        parts += mirrors(v, *v.mirror)
    if extra:
        parts += extra(v)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = ob.data
    while len(me.uv_layers):
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:  # box mapping in meters (only the tires use a texture)
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co.y, co.z) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y)
    # sharp creases where the shape turns hard (hood edge, pillars), smooth elsewhere
    bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    for m_ in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m_.name)
    log(v.name, len(me.polygons), 'faces')
    return ob


def wheels4(front, rear):
    return [(front, -1), (front, 1), (rear, -1), (rear, 1)]


S = lambda *p: list(p)
vehicles = []

# sedan: 4.85 m, a midsize four-door
v = V('sedan', 4.85, 1.84, 0.33, wheels4(-1.43, 1.43),
      top=S((0, 0.62), (0.03, 0.8), (0.1, 0.92), (0.27, 1.0), (0.42, 1.43), (0.7, 1.43), (0.84, 1.07), (0.95, 1.03), (1, 0.75)),
      belt=S((0, 0.6), (0.06, 0.78), (0.27, 0.98), (0.5, 1.0), (0.84, 1.03), (1, 0.75)),
      low=S((0, 0.32), (0.08, 0.17), (0.9, 0.17), (1, 0.33)),
      ws=None, rw=None, windows=[(0.29, 0.415, 'top'), (0.69, 0.83, 'top'), (0.33, 0.8, 'side')], pillars=[(0.535, 0.56)])
v.lights, v.mirror = (0.62, 0.78), (-0.75, 1.0)
v.doors, v.handles = (0.31, 0.545, 0.79), (0.5, 0.75)
vehicles.append(v)
# hatchback: 4.3 m
v = V('hatchback', 4.3, 1.78, 0.32, wheels4(-1.32, 1.3),
      top=S((0, 0.62), (0.03, 0.82), (0.1, 0.93), (0.25, 1.0), (0.4, 1.46), (0.8, 1.45), (0.95, 1.12), (1, 0.8)),
      belt=S((0, 0.6), (0.06, 0.8), (0.25, 0.98), (0.8, 1.04), (1, 0.8)),
      low=S((0, 0.32), (0.08, 0.17), (0.9, 0.17), (1, 0.35)),
      ws=None, rw=None, windows=[(0.26, 0.4, 'top'), (0.8, 0.96, 'top'), (0.3, 0.86, 'side')], pillars=[(0.56, 0.585)])
v.lights, v.mirror = (0.66, 0.82), (-0.65, 1.0)
v.doors, v.handles = (0.29, 0.57, 0.84), (0.53, 0.8)
vehicles.append(v)
# SUV: 4.9 m, taller, upright tailgate
v = V('suv', 4.9, 1.93, 0.37, wheels4(-1.45, 1.42),
      top=S((0, 0.75), (0.03, 0.95), (0.1, 1.08), (0.24, 1.15), (0.37, 1.74), (0.93, 1.72), (0.985, 1.55), (1, 0.9)),
      belt=S((0, 0.72), (0.06, 0.95), (0.24, 1.13), (0.6, 1.17), (1, 1.12)),
      low=S((0, 0.4), (0.07, 0.24), (0.92, 0.24), (1, 0.42)),
      ws=None, rw=None, windows=[(0.25, 0.36, 'top'), (0.935, 0.99, 'top'), (0.29, 0.93, 'side')], pillars=[(0.53, 0.555), (0.76, 0.785)], roof_in=0.1)
v.lights, v.mirror = (0.82, 0.98), (-0.85, 1.18)
v.doors, v.handles = (0.28, 0.54, 0.79), (0.5, 0.75)
vehicles.append(v)
# minivan: 5.15 m, short nose, long roof
v = V('minivan', 5.15, 1.99, 0.35, wheels4(-1.55, 1.5),
      top=S((0, 0.68), (0.03, 0.9), (0.08, 1.0), (0.15, 1.08), (0.31, 1.76), (0.95, 1.74), (0.99, 1.5), (1, 0.85)),
      belt=S((0, 0.66), (0.05, 0.9), (0.15, 1.06), (0.6, 1.1), (1, 1.06)),
      low=S((0, 0.36), (0.06, 0.18), (0.93, 0.18), (1, 0.38)),
      ws=None, rw=None, windows=[(0.2, 0.31, 'top'), (0.95, 0.995, 'top'), (0.2, 0.94, 'side')], pillars=[(0.36, 0.38), (0.6, 0.62)], roof_in=0.09)
v.lights, v.mirror = (0.74, 0.92), (-1.2, 1.12)
v.doors, v.handles = (0.19, 0.37, 0.72), (0.34, 0.42)
vehicles.append(v)
# pickup: 5.9 m crew cab with a covered bed
v = V('pickup', 5.9, 2.03, 0.4, wheels4(-1.85, 1.85),
      top=S((0, 0.9), (0.02, 1.15), (0.08, 1.25), (0.25, 1.32), (0.34, 1.92), (0.56, 1.92), (0.575, 1.4), (0.99, 1.38), (1, 1.0)),
      belt=S((0, 0.88), (0.04, 1.14), (0.25, 1.3), (0.56, 1.36), (1, 1.36)),
      low=S((0, 0.48), (0.05, 0.32), (0.95, 0.32), (1, 0.5)),
      ws=None, rw=None, windows=[(0.255, 0.335, 'top'), (0.3, 0.56, 'side')], pillars=[(0.42, 0.44)], roof_in=0.1, plan_round=0.06)
v.lights, v.mirror = (0.95, 1.15), (-1.1, 1.45)
v.doors, v.handles = (0.27, 0.43, 0.57), (0.4, 0.54)
vehicles.append(v)
# box truck: cab with a 2.4 m cargo box
v = V('boxtruck', 7.2, 2.3, 0.45, wheels4(-2.55, 1.85), paint='white',
      top=S((0, 1.1), (0.02, 1.35), (0.1, 1.5), (0.15, 2.45), (0.235, 2.5), (0.24, 3.2), (1, 3.2)),
      belt=S((0, 1.08), (0.1, 1.48), (0.2, 1.62), (0.24, 1.65), (1, 1.65)),
      low=S((0, 0.55), (0.04, 0.42), (0.97, 0.5), (1, 0.55)),
      ws=None, rw=None, windows=[(0.105, 0.15, 'top'), (0.15, 0.225, 'side')], pillars=[], roof_in=0.05, plan_round=0.03)
v.lights, v.mirror = (0.95, 1.15), (-3.0, 2.1)
v.doors, v.handles = (0.13, 0.235), (0.21,)
vehicles.append(v)
# school bus: Type C (conventional), 11.5 m, school bus yellow
v = V('schoolbus', 11.5, 2.44, 0.5, wheels4(-3.7, 2.4), paint='yellow',
      top=S((0, 1.15), (0.01, 1.45), (0.1, 1.65), (0.125, 1.75), (0.14, 3.05), (0.995, 3.05), (1, 2.9)),
      belt=S((0, 1.1), (0.1, 1.62), (0.14, 1.75), (1, 1.75)),
      low=S((0, 0.62), (0.02, 0.45), (0.98, 0.55), (1, 0.6)),
      ws=None, rw=None, windows=[(0.125, 0.145, 'top'), (0.15, 0.99, 'band'), (0.99, 1.0, 'flat')],
      pillars=[(0.15 + k * 0.064, 0.15 + k * 0.064 + 0.012) for k in range(14)], roof_in=0.06, plan_round=0.02)
v.win_band = (1.85, 2.6)
v.lights, v.mirror = (1.2, 1.4), (-4.4, 2.2)
v.doors, v.handles = (), ()


def bus_extras(v):
    parts = []
    # black rub rails along the sides
    for z in (1.0, 1.4, 1.78):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.75, z))
        o = bpy.context.object
        o.scale = (v.W + 0.03, v.L * 0.83, 0.05)
        o.data.materials.append(M['trim'])
        parts.append(o)
    # amber and red warning lights at the top corners, stop arm on the left
    for side in (-1, 1):
        for (y, m) in ((-v.L / 2 + 0.16 * v.L, 'amber'), (v.L / 2 - 0.02, 'tail')):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.09, depth=0.06, location=(side * 0.85, y, 2.85), rotation=(math.pi / 2, 0, 0))
            o = bpy.context.object
            o.data.materials.append(M[m])
            parts.append(o)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.02, vertices=8, location=(-v.W / 2 - 0.05, -v.L / 2 + 0.2 * v.L, 1.95), rotation=(0, math.pi / 2, 0))
    o = bpy.context.object
    o.data.materials.append(M['tail'])
    parts.append(o)
    return parts


vehicles.append(v)
v.extra = bus_extras
for vv in vehicles:
    if not hasattr(vv, 'extra'):
        vv.extra = None

built = []
for i, vv in enumerate(vehicles):
    ob = build(vv, vv.extra)
    ob.name = ob.data.name = vv.name
    built.append(ob)

for o in list(bpy.data.objects):
    if o not in built:
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in built:
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='JPEG', export_yup=True, export_apply=True)
log('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    x = 0
    for o in built:
        o.location.x = x
        x += (3.2 if o.name != 'schoolbus' else 4)
    bpy.ops.mesh.primitive_plane_add(size=80)
    fl = bpy.context.object
    fl.data.materials.append(mat('ground', (0.25, 0.25, 0.25), 0.8))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (x / 2 - 2, -13, 4.5)
    cam.rotation_euler = (math.radians(73), 0, math.radians(-12))
    cam.data.lens = 28
    w = bpy.data.worlds.new('w')
    scene.world = w
    w.use_nodes = True
    sky = w.node_tree.nodes.new('ShaderNodeTexSky')
    w.node_tree.links.new(sky.outputs[0], w.node_tree.nodes['Background'].inputs[0])
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
    sd = bpy.data.lights.new('sun', 'SUN')
    sd.energy = 4
    so = bpy.data.objects.new('sun', sd)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(so)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    except Exception:
        scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.render.resolution_x, scene.render.resolution_y = 1800, 700
    scene.render.filepath = os.path.join(PREVIEW, 'vehicles.png')
    bpy.ops.render.render(write_still=True)
    cam.location = (3.2 * 2 + 3.5, -5.5, 1.6)
    cam.rotation_euler = (math.radians(82), 0, math.radians(32))
    cam.data.lens = 35
    scene.render.resolution_x, scene.render.resolution_y = 1000, 700
    scene.render.filepath = os.path.join(PREVIEW, 'suv.png')
    bpy.ops.render.render(write_still=True)
