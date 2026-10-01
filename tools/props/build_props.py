"""Models the school's furniture in Blender and exports assets/models/props.glb.

    blender -b -P tools/props/build_props.py -- <ambientCG sets dir> <out.glb> [preview dir]

Each prop is one object named like its prototype in src/furniture.js (desk, chair, stool,
seat, roundTable, locker, clock), at the same size, with its origin on the floor. Blender's
-Y is the game's +Z, so a seated person, who faces the game's -Z, faces Blender's +Y here.

Materials use tileable PBR sets from ambientCG (CC0): Plastic013A (powder-coated steel),
Plastic010 (molded chair shells), Metal009 (brushed steel), Fabric030 (upholstery),
Rubber004 and Wood058 (desk laminate). Texture UVs are box-mapped in meters. A second UV
map holds an ambient occlusion bake (Cycles) per prop, exported as the glTF occlusion map,
so the props have soft contact shadows of their own. Materials whose name ends in "_fixed"
keep their color when the game tints an instance (chrome stays chrome on a blue locker).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SETS, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
AO_SIZE = 512


def log(*a):
    print('[props]', *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials
_img_cache = {}


def image(path, color):
    key = (path, color)
    if key not in _img_cache:
        im = bpy.data.images.load(path)
        im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        # the props are small and the textures tile: 512 px is plenty and keeps the file small
        if im.size[0] > 512:
            im.scale(512, 512)
            # save the smaller copy, or the exporter embeds the original file
            im.filepath_raw = os.path.join(bpy.app.tempdir, ('c_' if color else 'n_') + os.path.basename(path))
            im.file_format = 'JPEG'
            scene.render.image_settings.quality = 85
            im.save()
        _img_cache[key] = im
    return _img_cache[key]


def tex_path(set_id, kind):
    p = os.path.join(SETS, set_id, f'{set_id}_1K-JPG_{kind}.jpg')
    return p if os.path.exists(p) else None


def material(name, set_id=None, color=(1, 1, 1), rough=None, metal=0.0, tile=1.0, normal=1.0, fixed=False):
    """PBR material from an ambientCG set. tile: meters per texture repeat."""
    mat = bpy.data.materials.new(name + ('_fixed' if fixed else ''))
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    if rough is not None:
        bsdf.inputs['Roughness'].default_value = rough
    if set_id:
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

        def tex(kind, colorspace):
            p = tex_path(set_id, kind)
            if not p:
                return None
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = image(p, colorspace)
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
            return n

        c = tex('Color', True)
        if c:
            if color != (1, 1, 1):
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                mix.inputs[7].default_value = (*color, 1)
                nt.links.new(c.outputs['Color'], mix.inputs[6])
                nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            else:
                nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
        if rough is None:
            r = tex('Roughness', False)
            if r:
                nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
        n = tex('NormalGL', False)
        if n:
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = normal
            nt.links.new(n.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


MAT = {}


def lens_material():
    # prismatic acrylic lens: a fine grid of little pyramids, lit from behind; the emission
    # is above 1 so the game's bloom picks it up
    import numpy as np
    S = 128
    yy, xx = np.mgrid[0:S, 0:S] / 8.0
    fx, fy = xx % 1 - 0.5, yy % 1 - 0.5
    p = 1 - 2 * np.maximum(np.abs(fx), np.abs(fy))  # pyramid height 0..1
    shade = 0.82 + 0.18 * p + 0.06 * np.sign(fx + fy) * (1 - p)
    img = bpy.data.images.new('prism', S, S, alpha=False)
    px = np.ones((S, S, 4), np.float32)
    px[..., 0] = shade
    px[..., 1] = shade * 0.985
    px[..., 2] = shade * 0.955
    img.pixels.foreach_set(px.ravel())
    img.pack()
    mat = bpy.data.materials.new('lens_fixed')
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / 0.2, 1 / 0.2, 1)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 3.0
    b.inputs['Roughness'].default_value = 0.3
    return mat



def mats():
    M = MAT
    M['paint'] = material('paint', 'Plastic013A', color=(0.92, 0.92, 0.92), tile=0.3, normal=0.35)  # powder coat, tinted per instance
    M['paintDark'] = material('paintDark', 'Plastic013A', color=(0.06, 0.06, 0.065), tile=0.3, normal=0.35, fixed=True)
    M['slot'] = material('slot', None, color=(0.015, 0.015, 0.015), rough=0.9, fixed=True)
    M['chrome'] = material('chrome', 'Metal009', tile=0.25, metal=1.0, rough=0.22, fixed=True)
    M['steel'] = material('steel', 'Metal009', color=(0.75, 0.76, 0.78), tile=0.4, metal=1.0, fixed=True)
    M['rubber'] = material('rubber', 'Rubber004', tile=0.2, fixed=True)
    M['shell'] = material('shell', 'Plastic010', color=(0.95, 0.95, 0.95), tile=0.5, normal=0.5)  # chair shell, tinted
    M['blackPlastic'] = material('blackPlastic', 'Plastic010', color=(0.035, 0.035, 0.04), tile=0.5, normal=0.5, fixed=True)
    M['laminate'] = material('laminate', 'Wood058', color=(1.0, 0.97, 0.9), tile=1.2, normal=0.25, fixed=True)
    M['tmold'] = material('tmold', 'Plastic010', color=(0.16, 0.11, 0.08), tile=0.5, fixed=True)
    M['fabric'] = material('fabric', 'Fabric030', color=(0.95, 0.95, 0.95), tile=0.35, normal=0.8)  # tinted per instance
    M['tabletop'] = material('tabletop', 'Plastic013A', color=(0.9, 0.87, 0.8), tile=0.6, normal=0.15, fixed=True)
    M['blueSeat'] = material('blueSeat', 'Plastic010', color=(0.07, 0.2, 0.62), tile=0.5, normal=0.4, fixed=True)
    M['armWood'] = material('armWood', 'Wood058', color=(0.55, 0.38, 0.24), tile=0.8, normal=0.3, fixed=True)
    M['veneer'] = material('veneer', 'Wood058', color=(0.78, 0.56, 0.34), tile=1.6, normal=0.2, fixed=True)  # oak door
    M['glass'] = material('glass', None, color=(0.6, 0.68, 0.7), rough=0.05, fixed=True)
    g = M['glass']
    g.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.25
    g.blend_method = 'BLEND'
    M['trim'] = material('trim', 'Plastic013A', color=(0.93, 0.93, 0.92), tile=0.3, normal=0.2, fixed=True)
    M['lens'] = lens_material()


mats()

# ------------------------------------------------------------------ modeling helpers
parts = []


def link(ob):
    scene.collection.objects.link(ob)
    parts.append(ob)
    return ob


def mesh_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    return link(ob)


def box(x0, y0, z0, x1, y1, z1, mat, bevel=0.0, segs=1, name='box'):
    """Axis-aligned box in Blender coordinates (meters), optionally with rounded edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, (x1 - x0) / 2.01, (y1 - y0) / 2.01, (z1 - z0) / 2.01), segments=segs, profile=0.5, affect='EDGES')
    return mesh_obj(name, bm, mat)


def cyl(x, y, z0, z1, r, mat, verts=12, r1=None, name='cyl'):
    """Vertical cylinder (or cone if r1 given) on the Z axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r1 is None else r1, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, (z0 + z1) / 2))
    ob = mesh_obj(name, bm, mat)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return ob


def tube(points, r, mat, verts=8, name='tube'):
    """A round tube along a polyline, with rounded bends (a beveled curve)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = max(1, verts // 4 - 1)
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.resolution_u = 6
    ob = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.select_set(False)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    parts.append(ob)
    return ob


def straight_tube(a, b, r, mat, verts=8, name='tube'):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    ob = mesh_obj(name, bm, mat)
    for p in ob.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    return ob


def surface(fn, nu, nv, mat, thickness=0.0, name='surf', subdiv=0):
    """Parametric surface fn(u, v) -> (x, y, z), u, v in [0, 1], optionally thickened."""
    bm = bmesh.new()
    grid = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bm.normal_update()
    ob = mesh_obj(name, bm, mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    if thickness:
        m = ob.modifiers.new('solid', 'SOLIDIFY')
        m.thickness = thickness
        m.offset = 0
    if subdiv:
        m = ob.modifiers.new('sub', 'SUBSURF')
        m.levels = m.render_levels = subdiv
    return ob


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def box_uv(ob):
    """Box-mapped UVs in meters (each face projected along its dominant axis)."""
    me = ob.data
    if 'UVMap' not in me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers['UVMap']
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                uv.data[li].uv = (co.y * (1 if n.x > 0 else -1), co.z)
            elif ax == 1:
                uv.data[li].uv = (co.x * (-1 if n.y > 0 else 1), co.z)
            else:
                uv.data[li].uv = (co.x, co.y)


def finish(name):
    """Join the parts modeled since the last call into one object called `name`."""
    global parts
    for ob in parts:
        apply_all(ob)
        ob.data.uv_layers.clear() if hasattr(ob.data.uv_layers, 'clear') else None
        while len(ob.data.uv_layers):
            ob.data.uv_layers.remove(ob.data.uv_layers[0])
        box_uv(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # merge coincident vertices from the curve conversion, keep hard edges
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    parts = []
    # each prop gets its own copy of its materials: the ambient occlusion baked below is per
    # prop, and a shared material would carry one prop's AO onto all the others
    for slot in ob.material_slots:
        m = slot.material.copy()
        m.name = f'{name}_{slot.material.name}'  # keeps the "_fixed" ending
        slot.material = m
    log(name, len(ob.data.polygons), 'faces', [m.name for m in ob.data.materials])
    return ob


# ------------------------------------------------------------------ props
M = MAT
props = []


def locker():
    # 12" x 72" body on a 4" base, 15" deep; front faces Blender -Y (the game's +Z)
    W, D, B, H = 0.31, 0.40, 0.10, 1.85
    hw, hd = W / 2, D / 2
    box(-hw + 0.012, -hd + 0.03, 0, hw - 0.012, hd - 0.01, B, M['paintDark'])  # base, toe kick set back
    box(-hw, -hd + 0.006, B, hw, hd, B + H, M['paint'], bevel=0.003, segs=1)  # body
    # door: proud of the frame by 4 mm with a dark gap around it
    gx, gz = 0.016, 0.03
    box(-hw + gx - 0.003, -hd + 0.004, B + gz - 0.003, hw - gx + 0.003, -hd + 0.007, B + H - gz + 0.003, M['slot'])
    door = box(-hw + gx, -hd - 0.001, B + gz, hw - gx, -hd + 0.006, B + H - gz, M['paint'], bevel=0.0025, segs=1)
    # stiffening channel down the door: a soft vertical crease
    # louvers top and bottom: dark slots with a pressed lip above each
    for z0 in (B + H - 0.22, B + 0.08):
        for i in range(6):
            z = z0 + i * 0.022
            box(-0.075, -hd - 0.0016, z, 0.075, -hd - 0.0008, z + 0.006, M['slot'])
            box(-0.078, -hd - 0.006, z + 0.006, 0.078, -hd - 0.0005, z + 0.011, M['paint'])
    # recessed handle: stainless cup with a lift latch, and a padlock hasp
    zc = B + 0.95
    box(hw - gx - 0.055, -hd - 0.0035, zc - 0.07, hw - gx - 0.02, -hd - 0.0005, zc + 0.07, M['chrome'], bevel=0.004)
    box(hw - gx - 0.048, -hd - 0.0045, zc - 0.06, hw - gx - 0.027, -hd - 0.0035, zc + 0.06, M['slot'])
    box(hw - gx - 0.046, -hd - 0.014, zc - 0.012, hw - gx - 0.029, -hd - 0.003, zc + 0.03, M['chrome'], bevel=0.002)
    box(hw - gx - 0.044, -hd - 0.02, zc - 0.05, hw - gx - 0.031, -hd - 0.004, zc - 0.044, M['chrome'], bevel=0.001)
    # number plate
    box(-0.03, -hd - 0.0025, B + H - 0.28, 0.03, -hd - 0.0005, B + H - 0.255, M['steel'], bevel=0.002)
    # hinge knuckles on the left edge
    for z in (B + 0.2, B + H / 2, B + H - 0.2):
        box(-hw + gx - 0.006, -hd - 0.006, z - 0.04, -hw + gx + 0.002, -hd, z + 0.04, M['paint'])
    return finish('locker')


def desk():
    # student desk: 0.72 x 0.54 laminate top at 0.74 m with a T-mold edge, tubular legs that
    # telescope (outer tube, inner tube, glide) and a steel book box under the top
    T, X, Y = 0.74, 0.36, 0.27
    top = box(-X + 0.004, -Y + 0.004, T - 0.026, X - 0.004, Y - 0.004, T, M['laminate'], bevel=0.02, segs=4)
    box(-X, -Y, T - 0.028, X, Y, T - 0.004, M['tmold'], bevel=0.022, segs=4)  # edge band, a hair larger
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (X - 0.045), sy * (Y - 0.045)
            box(x - 0.016, y - 0.016, 0.38, x + 0.016, y + 0.016, T - 0.028, M['paint'], bevel=0.004)  # outer leg
            box(x - 0.012, y - 0.012, 0.02, x + 0.012, y + 0.012, 0.4, M['chrome'], bevel=0.003)  # inner leg
            cyl(x, y, 0.0, 0.022, 0.016, M['rubber'], verts=12, r1=0.013)  # glide
            cyl(x + 0.017, y, 0.45, 0.47, 0.004, M['chrome'], verts=8)  # adjustment pin
    # crossbars and the book box (open toward the seat, +Y here)
    for sx in (-1, 1):
        box(sx * (X - 0.045) - 0.01, -Y + 0.03, 0.52, sx * (X - 0.045) + 0.01, Y - 0.03, 0.54, M['paint'], bevel=0.003)
    bx0, bx1, by0, by1, bz0, bz1 = -0.3, 0.3, -0.22, 0.2, 0.55, 0.69
    box(bx0, by0, bz0, bx1, by1, bz0 + 0.004, M['paint'], bevel=0.0015)  # bottom
    box(bx0, by0, bz0, bx1, by0 + 0.004, bz1 - 0.06, M['paint'], bevel=0.0015)  # front lip
    for sx in (bx0, bx1 - 0.004):
        box(sx, by0, bz0, sx + 0.004, by1, bz1 - 0.05, M['paint'], bevel=0.0015)
    return finish('desk')


def chair():
    # polypropylene shell chair: one molded seat-and-back shell on four steel legs; seat
    # 44 cm high; the sitter faces +Y (the game's -Z), the back is toward -Y
    def shell(u, v):
        # v: 0 at the seat's front edge, 1 at the top of the back; u: -1..1 across
        x = u * (0.215 - 0.02 * (v > 0.55) * (v - 0.55))
        if v < 0.55:  # seat, front to back, slightly dished, waterfall front edge
            t = v / 0.55
            y = 0.2 - t * 0.37
            z = 0.445 - 0.012 * math.sin(math.pi * t) + 0.012 * (u * u) - (0.02 * (1 - t / 0.08) if t < 0.08 else 0)
        else:  # curve up into the back, leaning back ~12 degrees, cupped across
            t = (v - 0.55) / 0.45
            a = t * (math.pi / 2 - 0.21)
            rad = 0.07
            y = -0.17 - rad * math.sin(a) - max(0, t - 0.25) * 0.09
            z = 0.445 + rad * (1 - math.cos(a)) + max(0, t - 0.0) * 0.36
            y += 0.03 * (u * u)
        return (x, y, z)

    s = surface(shell, 10, 20, M['shell'], thickness=0.007)
    # legs: front pair and back pair, splayed a little, from mounting plates under the seat
    for sx in (-1, 1):
        straight_tube((sx * 0.17, 0.12, 0.43), (sx * 0.2, 0.19, 0.0), 0.011, M['chrome'])
        straight_tube((sx * 0.17, -0.12, 0.43), (sx * 0.2, -0.2, 0.0), 0.011, M['chrome'])
        straight_tube((sx * 0.17, 0.12, 0.43), (sx * 0.17, -0.12, 0.43), 0.009, M['chrome'])
        for y in (0.19, -0.2):
            cyl(sx * 0.2, y, 0.0, 0.012, 0.014, M['rubber'], verts=10)
    box(-0.19, -0.14, 0.425, 0.19, 0.14, 0.432, M['steel'])
    return finish('chair')


def stool():
    # lab stool: round molded seat at 0.66 m, four splayed legs and a foot ring
    cyl(0, 0, 0.62, 0.66, 0.17, M['shell'], verts=32, r1=0.165)
    cyl(0, 0, 0.6, 0.625, 0.12, M['steel'], verts=24)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        straight_tube((0.1 * math.cos(a), 0.1 * math.sin(a), 0.61), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0), 0.011, M['chrome'])
        cyl(0.2 * math.cos(a), 0.2 * math.sin(a), 0, 0.012, 0.014, M['rubber'], verts=10)
    ring = [(0.168 * math.cos(t), 0.168 * math.sin(t), 0.27) for t in [i * math.pi / 8 for i in range(17)]]
    tube(ring, 0.008, M['chrome'])
    return finish('stool')


def seat():
    # theatre seat (seat folded down): upholstered back and seat cushions, a dark plastic
    # back shell, end standards with wooden armrests; the audience faces +Y
    # back: cushion toward +Y, shell behind
    def back(u, v):
        x = (u * 2 - 1) * 0.235
        z = 0.48 + v * 0.52
        y = -0.15 - v * 0.08 + 0.025 * (1 - (u * 2 - 1) ** 2)
        return (x, y, z)

    surface(back, 6, 6, M['fabric'], thickness=0.07)
    surface(lambda u, v: (back(u, v)[0] * 1.02, back(u, v)[1] - 0.05, back(u, v)[2]), 10, 12, M['blackPlastic'], thickness=0.012)
    # seat cushion, front edge rounded down
    box(-0.23, -0.17, 0.4, 0.23, 0.22, 0.5, M['fabric'], bevel=0.035, segs=2)
    box(-0.235, -0.15, 0.37, 0.235, 0.2, 0.405, M['blackPlastic'], bevel=0.01)
    # standards (shared between neighbors in a row; each seat carries one, at -X)
    for sx in (-1,):
        x = sx * 0.265
        box(x - 0.018, -0.25, 0.0, x + 0.018, 0.1, 0.62, M['blackPlastic'], bevel=0.01)
        box(x - 0.03, -0.27, 0.62, x + 0.03, 0.22, 0.66, M['armWood'], bevel=0.012, segs=3)
        box(x - 0.03, -0.25, 0.0, x + 0.03, 0.12, 0.02, M['steel'], bevel=0.004)
    return finish('seat')


def round_table():
    # cafeteria table: laminate top on a pedestal with four swing-out curved bench seats
    cyl(0, 0, 0.735, 0.77, 0.76, M['tmold'], verts=40)
    cyl(0, 0, 0.75, 0.772, 0.75, M['tabletop'], verts=40)
    cyl(0, 0, 0.04, 0.735, 0.055, M['steel'], verts=20, r1=0.06)
    cyl(0, 0, 0.0, 0.045, 0.34, M['steel'], verts=32, r1=0.3)
    for k in range(4):
        mid = math.pi / 4 + k * math.pi / 2
        span = math.pi / 3

        def seat_surf(u, v, mid=mid):
            a = mid - span / 2 + u * span
            r = 0.95 + v * 0.32
            return (r * math.cos(a), -r * math.sin(a), 0.47)

        s = surface(seat_surf, 12, 2, M['blueSeat'], thickness=0.045)
        ca, sa = math.cos(mid), -math.sin(mid)
        straight_tube((0.05 * ca, 0.05 * sa, 0.39), (1.1 * ca, 1.1 * sa, 0.39), 0.022, M['steel'])
        straight_tube((1.1 * ca, 1.1 * sa, 0.0), (1.1 * ca, 1.1 * sa, 0.45), 0.024, M['steel'])
        cyl(1.1 * ca, 1.1 * sa, 0.0, 0.015, 0.04, M['rubber'], verts=14)
    return finish('roundTable')


def clock_face_image():
    # a school clock face drawn into an image (numbers as tick bars, Blender has no text raster)
    S = 256
    img = bpy.data.images.new('clockface', S, S, alpha=False)
    import numpy as np
    yy, xx = np.mgrid[0:S, 0:S]
    cx = cy = (S - 1) / 2
    r = np.hypot(xx - cx, yy - cy) / (S / 2)
    ang = np.arctan2(yy - cy, xx - cx)
    px = np.ones((S, S, 4), np.float32)
    px[..., :3] = 0.96
    # minute ticks and hour bars
    m = (np.abs(((ang / (2 * np.pi) * 60) + 0.5) % 1 - 0.5) < 0.09) & (r > 0.86) & (r < 0.93)
    h = (np.abs(((ang / (2 * np.pi) * 12) + 0.5) % 1 - 0.5) < 0.05) & (r > 0.72) & (r < 0.93)
    for msk in (m, h):
        px[msk, :3] = 0.05
    # hands at 10:10
    def hand(theta, length, width):
        d = np.stack([xx - cx, yy - cy], -1) / (S / 2)
        u = np.array([math.cos(theta), math.sin(theta)])
        along = d @ u
        perp = np.abs(d @ np.array([-u[1], u[0]]))
        return (along > -0.1) & (along < length) & (perp < width)
    px[hand(math.radians(90 + 60), 0.5, 0.035), :3] = 0.05  # hour (image y is up)
    px[hand(math.radians(90 - 60), 0.78, 0.022), :3] = 0.05  # minute
    px[hand(math.radians(90 - 200), 0.8, 0.008), :3] = (0.7, 0.05, 0.05)  # second
    px[r > 1.0, :3] = 0.05
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def clock():
    # wall clock: black rim, white face, domed lens; faces Blender +Y (the game's -Z)
    face = material('clockFace', None, rough=0.4, fixed=True)
    nt = face.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = clock_face_image()
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=0.155)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0.012, 0))
    f = mesh_obj('face', bm, face)
    rim = bpy.data.objects.new('rim', bpy.data.meshes.new('rim'))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=0.17, radius2=0.17, depth=0.035)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0.0175, 0))
    r = mesh_obj('rim', bm, M['blackPlastic'])
    m = r.modifiers.new('s', 'SOLIDIFY')
    m.thickness = 0.016
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=0.17)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))
    back = mesh_obj('back', bm, M['blackPlastic'])
    ob = finish('clock')
    # the face keeps a planar UV over the dial (box_uv mapped it in meters)
    me = ob.data
    uv = me.uv_layers['UVMap']
    fi = [i for i, m_ in enumerate(me.materials) if 'clockFace' in m_.name][0]
    for p in me.polygons:
        if p.material_index == fi:
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (0.5 - co.x / 0.31, 0.5 + co.z / 0.31)
    return ob


DOOR_H = 12 * 0.1778  # 7 ft, as in src/layout.js


def door(face, name):
    # a classroom door leaf, 1 m wide (the game scales it to the opening), hinged on its
    # x = 0 edge, 44 mm thick; narrow vision lite by the latch, lever handles, kick plates,
    # three butt hinges and a closer on the room side
    W, T = 1.0, 0.022
    z0, z1 = 0.01, DOOR_H - 0.04
    lx0, lx1, lz0, lz1 = 0.74, 0.86, 1.05, 1.85  # vision lite
    box(0.004, -T, z0, W, T, lz0, face, bevel=0.002)
    box(0.004, -T, lz1, W, T, z1, face, bevel=0.002)
    box(0.004, -T, lz0, lx0, T, lz1, face)
    box(lx1, -T, lz0, W, T, lz1, face)
    box(lx0, -0.003, lz0, lx1, 0.003, lz1, M['glass'])
    for sy in (-1, 1):
        y = sy * (T + 0.002)
        # stop/trim around the glass
        for (a0, a1, b0, b1) in ((lx0 - 0.015, lx1 + 0.015, lz0 - 0.015, lz0), (lx0 - 0.015, lx1 + 0.015, lz1, lz1 + 0.015),
                                 (lx0 - 0.015, lx0, lz0, lz1), (lx1, lx1 + 0.015, lz0, lz1)):
            box(a0, min(y, sy * T), b0, a1, max(y, sy * T), b1, M['steel'])
        # kick plate
        box(0.03, min(y, sy * T), z0 + 0.02, W - 0.03, max(y, sy * T), z0 + 0.27, M['steel'], bevel=0.001)
        # lever handle: rose and lever, pointing toward the hinge
        rose_y0, rose_y1 = sorted((sy * T, sy * (T + 0.012)))
        box(W - 0.09, rose_y0, 0.94, W - 0.05, rose_y1, 1.12, M['chrome'], bevel=0.006, segs=2)
        straight_tube((W - 0.07, sy * (T + 0.012), 1.02), (W - 0.07, sy * (T + 0.06), 1.02), 0.009, M['chrome'])
        straight_tube((W - 0.07, sy * (T + 0.06), 1.02), (W - 0.2, sy * (T + 0.065), 1.02), 0.01, M['chrome'])
    for z in (0.25, DOOR_H / 2 + 0.1, DOOR_H - 0.3):
        box(-0.006, -0.014, z - 0.06, 0.006, 0.014, z + 0.06, M['chrome'], bevel=0.002)
    # closer on the room side (+y): body near the hinge, arm to the frame
    box(0.08, T, z1 - 0.12, 0.38, T + 0.055, z1 - 0.06, M['paintDark'], bevel=0.008, segs=2)
    straight_tube((0.36, T + 0.06, z1 - 0.07), (0.18, T + 0.08, z1 + 0.02), 0.008, M['paintDark'])
    return finish(name)


def troffer():
    # 2x4 lay-in fixture: painted steel flange flush with the ceiling, prismatic lens
    # recessed 1 cm; origin on the ceiling plane, hanging down (-Z), long side along Y
    for (a0, a1, b0, b1) in ((-0.31, 0.31, -0.61, -0.585), (-0.31, 0.31, 0.585, 0.61), (-0.31, -0.285, -0.585, 0.585), (0.285, 0.31, -0.585, 0.585)):
        box(a0, b0, -0.012, a1, b1, 0.0, M['trim'])
    box(-0.286, -0.586, -0.004, 0.286, 0.586, -0.002, M['lens'])
    return finish('troffer')


def backpack():
    # school backpack worn by the player: origin at the middle of the back panel, the bag
    # hanging behind (Blender -Y, away from the wearer, who faces +Y)
    M['strap'] = M.get('strap') or material('strap', 'Fabric030', color=(0.05, 0.05, 0.055), tile=0.2, fixed=True)
    box(-0.15, -0.16, -0.22, 0.15, 0.0, 0.2, M['fabric'], bevel=0.05, segs=3)  # main compartment
    box(-0.12, -0.215, -0.2, 0.12, -0.12, -0.02, M['fabric'], bevel=0.035, segs=3)  # front pocket
    box(-0.145, -0.155, 0.17, 0.145, -0.148, 0.178, M['blackPlastic'])  # main zipper (top arc, simplified)
    box(-0.11, -0.218, -0.03, 0.11, -0.21, -0.022, M['blackPlastic'])  # pocket zipper
    for sx in (-1, 1):
        box(sx * 0.03 - 0.008, -0.225, -0.05, sx * 0.03 + 0.008, -0.214, -0.02, M['chrome'])  # zipper pulls
        # straps: from the top of the bag over the shoulder, and their ends at the bottom
        straight_tube((sx * 0.08, 0.0, 0.18), (sx * 0.09, 0.08, 0.27), 0.022, M['strap'])
        box(sx * 0.1 - 0.03, 0.0, -0.22, sx * 0.1 + 0.03, 0.03, -0.1, M['strap'], bevel=0.008)
    tube([(-0.04, -0.06, 0.2), (0.0, -0.06, 0.25), (0.04, -0.06, 0.2)], 0.009, M['strap'])  # grab handle
    return finish('backpack')


def fountain():
    # hi-lo drinking fountain, wall mounted: two stainless bowls side by side at wheelchair
    # and standing heights, each with a bubbler and a front push bar. Back on the wall at
    # Blender y = 0, sticking out toward -Y (the game's +Z)
    for (x0, x1, top) in ((-0.49, 0.0, 0.86), (0.0, 0.49, 1.02)):
        box(x0 + 0.01, -0.46, top - 0.17, x1 - 0.01, 0.0, top, M['steel'], bevel=0.03, segs=3)  # bowl body
        box(x0 + 0.06, -0.4, top - 0.04, x1 - 0.06, -0.06, top + 0.002, M['slot'], bevel=0.02, segs=2)  # basin
        cx = (x0 + x1) / 2
        cyl(cx + 0.1, -0.12, top - 0.04, top + 0.035, 0.014, M['chrome'], verts=10)  # bubbler
        box(x0 + 0.05, -0.475, top - 0.12, x1 - 0.05, -0.455, top - 0.07, M['chrome'], bevel=0.008, segs=2)  # push bar
        box(x0 + 0.04, -0.03, top - 0.42, x1 - 0.04, 0.0, top - 0.17, M['steel'])  # apron/wall plate
    return finish('fountain')


def trashcan():
    # 32-gallon round utility can (gray plastic), with a black liner folded over the rim
    M['grayPlastic'] = M.get('grayPlastic') or material('grayPlastic', 'Plastic010', color=(0.32, 0.33, 0.33), tile=0.4, normal=0.5, fixed=True)
    cyl(0, 0, 0.0, 0.74, 0.245, M['grayPlastic'], verts=28, r1=0.28)
    cyl(0, 0, 0.72, 0.78, 0.295, M['grayPlastic'], verts=28)  # rim
    cyl(0, 0, 0.78, 0.785, 0.275, M['slot'], verts=28)  # the opening (dark inside)
    cyl(0, 0, 0.66, 0.73, 0.284, M['blackPlastic'], verts=28, r1=0.29)  # liner over the rim
    for k in range(4):  # venting channels down the side
        a = k * math.pi / 2
        box(math.cos(a) * 0.26 - 0.02, math.sin(a) * 0.26 - 0.02, 0.1, math.cos(a) * 0.26 + 0.02, math.sin(a) * 0.26 + 0.02, 0.66, M['grayPlastic'])
    return finish('trashcan')


def exit_sign():
    # wall-mounted EXIT sign: white housing, red letters lit from inside
    if 'exitRed' not in M:
        m = material('exitRed', None, color=(0.8, 0.05, 0.03), rough=0.3, fixed=True)
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Emission Color'].default_value = (1, 0.05, 0.03, 1)
        b.inputs['Emission Strength'].default_value = 4.0
        M['exitRed'] = m
    box(-0.17, -0.06, -0.11, 0.17, 0.0, 0.11, M['trim'], bevel=0.01, segs=2)
    bpy.ops.object.text_add(location=(0, -0.0605, 0.0))
    t = bpy.context.object
    t.data.body = 'EXIT'
    t.data.size = 0.13
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.extrude = 0.002
    t.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.object
    t.data.materials.clear()
    t.data.materials.append(M['exitRed'])
    parts.append(t)
    return finish('exitSign')


# ------------------------------------------------------------------ AO bake
def bake_ao(ob):
    me = ob.data
    ao = me.uv_layers.new(name='ao')
    me.uv_layers.active = ao
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(ob.name + '_ao', AO_SIZE, AO_SIZE, alpha=False)
    for mat in me.materials:
        nt = mat.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.name = 'ao_target'
        n.image = img
        nt.nodes.active = n
    # a floor so the AO includes contact with the ground
    bpy.ops.mesh.primitive_plane_add(size=6)
    floor = bpy.context.object
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene.cycles.samples = 128
    bpy.ops.object.bake(type='AO', margin=4, use_clear=True)
    bpy.data.objects.remove(floor)
    img.pack()
    me.uv_layers.active = me.uv_layers['UVMap']
    # wire it as the glTF occlusion texture (the exporter reads a "glTF Material Output" group)
    grp = bpy.data.node_groups.get('glTF Material Output')
    if not grp:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    for mat in me.materials:
        nt = mat.node_tree
        n = nt.nodes['ao_target']
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'ao'
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(n.outputs['Color'], sep.inputs[0])
        g = nt.nodes.new('ShaderNodeGroup')
        g.node_tree = grp
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    log('baked AO for', ob.name)


scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception as e:  # noqa: BLE001
    log('GPU unavailable, baking on the CPU', e)
    scene.cycles.device = 'CPU'

built = []
for fn in (locker, desk, chair, stool, seat, round_table, clock, lambda: door(M['veneer'], 'doorWood'), lambda: door(M['paint'], 'doorSteel'), troffer, backpack, fountain, trashcan, exit_sign):
    ob = fn()
    built.append(ob)
x = 0
for ob in built:
    ob.location.x = 0  # keep origins at the floor center for export
for ob in built:
    # hide the others so each AO bake sees only its own prop
    for o in built:
        o.hide_render = o is not ob
    bake_ao(ob)
for o in built:
    o.hide_render = False

# ------------------------------------------------------------------ export
for o in list(bpy.data.objects):
    if o not in built:
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in built:
    o.select_set(True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='JPEG',
                          export_jpeg_quality=88, export_yup=True, export_apply=True, export_texcoords=True,
                          export_normals=True, export_tangents=False, export_materials='EXPORT')
log('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    # lay them out in a row and render a studio preview with Cycles
    for i, o in enumerate(built):
        o.location.x = i * 1.2 - 3.6
    bpy.ops.mesh.primitive_plane_add(size=30)
    fl = bpy.context.object
    fl.data.materials.append(material('floorprev', None, color=(0.5, 0.5, 0.5), rough=0.6))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0, -5.2, 1.9)
    cam.rotation_euler = (math.radians(73), 0, 0)
    cam.data.lens = 32
    w = bpy.data.worlds.new('w')
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    for loc, e in (((3, -4, 6), 900), ((-4, -2, 4), 300)):
        ld = bpy.data.lights.new('l', 'AREA')
        ld.energy = e
        ld.size = 3
        lo = bpy.data.objects.new('l', ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(lo)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.filepath = os.path.join(PREVIEW, 'props.png')
    bpy.ops.render.render(write_still=True)
    # close-ups
    for name, loc, rot, lens in (('locker', (-3.6 + 0.6, -1.2, 1.3), (82, 0, 25), 35), ('chair', (-1.2 + 0.9, -1.4, 1.0), (70, 0, 30), 40)):
        cam.location = loc
        cam.rotation_euler = tuple(math.radians(a) for a in rot)
        cam.data.lens = lens
        scene.render.resolution_x, scene.render.resolution_y = 800, 800
        scene.render.filepath = os.path.join(PREVIEW, name + '.png')
        bpy.ops.render.render(write_still=True)
