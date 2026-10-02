"""Retargets motion capture (BVH) onto a Rocketbox avatar and exports a glTF for the game.

    python3 tools/character/textures.py <avatar>/Textures <tex dir>
    blender -b -P tools/character/retarget.py -- <avatar.fbx> <tex dir> <mocap dir> <out.glb>

The avatar is one of Microsoft's Rocketbox avatars (MIT). The clips come from the Bandai
Namco Research Motion dataset (walk/run/dash, CC BY-NC 4.0) and the CMU Graphics Lab
motion capture database (idle, jump, swim); see assets/models/people/CREDITS.md.

How the retarget works: a BVH joint's world rotation relative to its rest pose is known for
every frame. For every target bone we build a "semantic frame" from rest-pose joint
positions that mean the same thing on both skeletons (the bone's direction to its child,
plus the body's left-right or front-back axis). Rotating the source frame by the source
joint's world delta and expressing the target bone in that frame cancels out any difference
between the two rest poses (Rocketbox stands in an A-pose; the Bandai skeleton's rest pose
has every limb along one axis). Knees and elbows use their hinge axes as the secondary axis,
so they bend in the avatar's own hinge plane (see HINGES). The pelvis also gets the source's
hip translation (of the point between the hip joints), scaled by leg length. Each clip is
then cut to a seamless loop (where it loops), made in-place, set down so the feet meet the
floor, and resampled to 30 fps.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
FBX, TEXDIR, MOCAP, OUT = argv[:4]
ONLY = argv[4].split(',') if len(argv) > 4 else None
FPS = 30

# source skeletons: semantic joint name -> BVH joint name
SRC_BN = dict(hips='Hips', spine='Spine', chest='Chest', neck='Neck', head='Head',
              clavL='Shoulder_L', armL='UpperArm_L', foreL='LowerArm_L', handL='Hand_L',
              clavR='Shoulder_R', armR='UpperArm_R', foreR='LowerArm_R', handR='Hand_R',
              thighL='UpperLeg_L', calfL='LowerLeg_L', footL='Foot_L', toeL='Toes_L',
              thighR='UpperLeg_R', calfR='LowerLeg_R', footR='Foot_R', toeR='Toes_R')
SRC_CMU = dict(hips='Hips', spine='LowerBack', chest='Spine1', neck='Neck1', head='Head',
               clavL='LeftShoulder', armL='LeftArm', foreL='LeftForeArm', handL='LeftHand',
               clavR='RightShoulder', armR='RightArm', foreR='RightForeArm', handR='RightHand',
               thighL='LeftUpLeg', calfL='LeftLeg', footL='LeftFoot', toeL='LeftToeBase',
               thighR='RightUpLeg', calfR='RightLeg', footR='RightFoot', toeR='RightToeBase')
TGT = dict(hips='Bip01 Pelvis', spine='Bip01 Spine', chest='Bip01 Spine2', neck='Bip01 Neck', head='Bip01 Head',
           clavL='Bip01 L Clavicle', armL='Bip01 L UpperArm', foreL='Bip01 L Forearm', handL='Bip01 L Hand',
           clavR='Bip01 R Clavicle', armR='Bip01 R UpperArm', foreR='Bip01 R Forearm', handR='Bip01 R Hand',
           thighL='Bip01 L Thigh', calfL='Bip01 L Calf', footL='Bip01 L Foot', toeL='Bip01 L Toe0',
           thighR='Bip01 R Thigh', calfR='Bip01 R Calf', footR='Bip01 R Foot', toeR='Bip01 R Toe0')
# the bone's primary axis runs from joint a to joint b; the secondary axis is the body's
# lateral ('lat', hips or shoulders) or forward ('fwd') direction at rest, or for the bones
# on either side of a knee or elbow, that joint's hinge axis (see HINGES)
FRAMES = dict(
    # the torso, neck and head use the body's up axis: both reference poses stand upright,
    # but the spine and neck curve differently on the two skeletons
    hips=('hips', 'neck', 'latH'), spine=('hips', 'neck', 'latS'), chest=('hips', 'neck', 'latS'),
    neck=('hips', 'neck', 'latS'), head=('hips', 'neck', 'latS'),
    clavL=('clavL', 'armL', 'fwd'), armL=('armL', 'foreL', 'elbowL'), foreL=('foreL', 'handL', 'elbowL'), handL=('foreL', 'handL', 'fwd'),
    clavR=('clavR', 'armR', 'fwd'), armR=('armR', 'foreR', 'elbowR'), foreR=('foreR', 'handR', 'elbowR'), handR=('foreR', 'handR', 'fwd'),
    thighL=('thighL', 'calfL', 'kneeL'), calfL=('calfL', 'footL', 'kneeL'), footL=('footL', 'toeL', 'latH'), toeL=('footL', 'toeL', 'latH'),
    thighR=('thighR', 'calfR', 'kneeR'), calfR=('calfR', 'footR', 'kneeR'), footR=('footR', 'toeR', 'latH'), toeR=('footR', 'toeR', 'latH'),
)
# Knees and elbows are hinges, but which way a hinge faces relative to the hips or shoulders
# differs between skeletons (Rocketbox's knees turn out about 16 degrees from its hips'
# lateral axis, the mocap actors' by 3 to 6). Lining the limbs up by the lateral axis bent
# the avatar's knees and elbows off their own hinges, sideways through the mesh. Instead the
# hinge axes themselves are matched: the avatar's from its skeleton (T_hinge), the source's
# measured from the clip, where it bends them. Joint -> (upper, lower, end, fallback
# secondary axis when a clip never bends that joint enough to measure it).
HINGES = dict(kneeL=('thighL', 'calfL', 'footL', 'latH'), kneeR=('thighR', 'calfR', 'footR', 'latH'),
              elbowL=('armL', 'foreL', 'handL', 'fwd'), elbowR=('armR', 'foreR', 'handR', 'fwd'))

# clip name -> (file, skeleton, start s, end s (None = to the end), loop?, notes)
CLIPS = {
    'walk': ('bn_walk_normal_001.bvh', 'bn', 0.0, None, 'cycle'),
    'idle': ('cmu_77_02.bvh', 'cmu', 0.5, None, 'idle'),
    'run': ('cmu_35_17.bvh', 'cmu', 0.1, None, 'cycle'),
    'sprint': ('cmu_16_46.bvh', 'cmu', 0.1, None, 'cycle'),
    'jump': ('cmu_16_01.bvh', 'cmu', 0.3, None, 'once'),
    'swim': ('cmu_126_10.bvh', 'cmu', 0.3, None, 'cycle'),
}


def log(*a):
    print('[retarget]', *a, flush=True)


# ------------------------------------------------------------------ target
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FBX, automatic_bone_orientation=False)
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
if arm.animation_data:
    arm.animation_data.action = None
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
assert arm.matrix_world == Matrix.Identity(4), arm.matrix_world

tb = arm.data.bones
T_rest = {b.name: b.matrix_local.copy() for b in tb}
T_head = {k: tb[v].head_local.copy() for k, v in TGT.items()}


def semantic_frames(J, hinge):
    """J: semantic joint -> rest position; hinge: knee/elbow -> its hinge axis at rest (a
    missing one falls back to HINGES' axis). Returns semantic bone -> 3x3 frame (columns)."""
    up = (J['neck'] - J['hips']).normalized()
    latS = (J['armR'] - J['armL']).normalized()
    latH = (J['thighR'] - J['thighL']).normalized()
    fwd = latS.cross(up).normalized()
    sec = dict(latS=latS, latH=latH, fwd=fwd)
    for h, (_, _, _, fallback) in HINGES.items():
        sec[h] = hinge[h] if h in hinge else sec[fallback]
    out = {}
    for k, (a, b, s) in FRAMES.items():
        p = (J[b] - J[a]).normalized()
        q = sec[s] - p * sec[s].dot(p)
        q.normalize()
        out[k] = Matrix((p, q, p.cross(q))).transposed()
    return out


def bend_axis(a, b, c):
    """Hinge axis of the joint at b, from joint positions a-b-c (the flexion direction)."""
    return (b - a).cross(c - b).normalized()


# The avatar's hinges: a Biped calf or forearm turns about its own local Z axis. Signed so
# that bending moves the shin back and the forearm forward (forward is where the toes point);
# where the rest pose is bent (the male avatars' knees by 7 degrees, all elbows by 21-23)
# that is checked against the bend itself.
_fwd = sum((T_head['toe' + s] - T_head['foot' + s] for s in 'LR'), Vector())
_fwd.z = 0
_fwd.normalize()
T_hinge = {}
for h, (a, b, c, _) in HINGES.items():
    z = T_rest[TGT[b]].to_3x3().col[2].normalized()
    flex = -_fwd if h.startswith('knee') else _fwd
    if z.dot((T_head[b] - T_head[a]).cross(flex)) < 0:
        z = -z
    if (T_head[b] - T_head[a]).angle(T_head[c] - T_head[b]) > math.radians(3):
        assert z.angle(bend_axis(T_head[a], T_head[b], T_head[c])) < math.radians(5), f'{h}: rest bend is off its local Z'
    T_hinge[h] = z
tgt_leg = (T_head['thighL'] - T_head['calfL']).length + (T_head['calfL'] - T_head['footL']).length
order = []  # target bones, parents first


def walk(b):
    order.append(b.name)
    for c in b.children:
        walk(c)


for b in tb:
    if b.parent is None:
        walk(b)
sem_of = {v: k for k, v in TGT.items()}
# Spine1 sits between Spine and Spine2: give it half of each
BLEND = {'Bip01 Spine1': ('spine', 'chest')}


REF = {}


def sample_clip(name, file, kind, t0, t1):
    path = os.path.join(MOCAP, file)
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, global_scale=1.0, rotate_mode='NATIVE', update_scene_fps=False, update_scene_duration=False)
    src = next(o for o in bpy.data.objects if o not in before)
    act = src.animation_data.action
    f0, f1 = (int(v) for v in act.frame_range)
    with open(path) as fh:
        ft = float(next(l for l in fh if l.strip().startswith('Frame Time')).split(':')[1])
    SRC = SRC_BN if kind == 'bn' else SRC_CMU
    sb = src.data.bones
    rest = {k: src.matrix_world @ sb[v].matrix_local for k, v in SRC.items()}
    if kind == 'bn':
        # The Bandai skeleton's rest pose has every limb along one axis, so its rest
        # orientations say nothing about anatomy. The walk clip starts standing still: that
        # first frame is the reference pose, reused (as rotations from rest, which don't
        # depend on the skeleton's proportions) for clips that start mid-stride.
        if 'bn' not in REF:
            bpy.context.scene.frame_set(f0)
            m = {k: src.matrix_world @ src.pose.bones[v].matrix for k, v in SRC.items()}
            REF['bn'] = ({k: m[k].to_quaternion() @ rest[k].to_quaternion().inverted() for k in SRC},
                         {k: m[k].translation.copy() for k in SRC})
        D, J = REF['bn']
        S_rest_rot = {k: D[k] @ rest[k].to_quaternion() for k in SRC}
    else:
        J = {k: m.translation.copy() for k, m in rest.items()}
        S_rest_rot = {k: m.to_quaternion() for k, m in rest.items()}
    n_src = f1 - f0 + 1
    step = 1.0 / (ft * FPS)  # source frames per output frame
    first = f0 + int(round(t0 / ft))
    last = f1 if t1 is None else min(f1, f0 + int(round(t1 / ft)))
    sc = bpy.context.scene
    # The source's hinge axes, measured where the clip bends them: the bend axis is fixed in
    # the upper bone's frame (a mocap knee or elbow is a clean hinge), carried to the rest pose
    hinge, axes = {}, {h: [] for h in HINGES}
    for fi in range(first, last + 1, 2):
        sc.frame_set(fi)
        m = {key: src.matrix_world @ src.pose.bones[SRC[key]].matrix for key in SRC}
        for h, (a, b, c, _) in HINGES.items():
            pa, pb, pc = m[a].translation, m[b].translation, m[c].translation
            if (pb - pa).angle(pc - pb) > math.radians(8):
                axes[h].append(m[a].to_quaternion().inverted() @ bend_axis(pa, pb, pc))
    for h, v in axes.items():
        if len(v) >= 5:
            hinge[h] = (S_rest_rot[HINGES[h][0]] @ sum(v, Vector()).normalized()).normalized()
    S_frames = semantic_frames(J, hinge)
    T_frames = semantic_frames(T_head, {h: T_hinge[h] for h in hinge})
    R0 = {k2: m.translation for k2, m in rest.items()}
    src_leg = (R0['thighL'] - R0['calfL']).length + (R0['calfL'] - R0['footL']).length
    k = tgt_leg / src_leg
    # per semantic bone: target world rot = delta_src @ S_frame @ T_frame^-1 @ T_rest_rot
    corr = {key: (S_frames[key] @ T_frames[key].inverted()).to_quaternion() for key in FRAMES}
    T_rest_q = {key: T_rest[TGT[key]].to_quaternion() for key in FRAMES}
    frames = []
    fsrc = float(first)
    while fsrc <= last:
        fi = int(math.floor(fsrc))
        sc.frame_set(fi, subframe=fsrc - fi)
        pose = {}
        for key, v in SRC.items():
            m = src.matrix_world @ src.pose.bones[v].matrix
            pose[key] = (m.to_quaternion() @ S_rest_rot[key].inverted(), m.translation.copy())
        world = {}
        for key in FRAMES:
            d = pose[key][0]
            world[key] = d @ corr[key] @ T_rest_q[key]
        # 'hips' is the point between the hip joints (not the root joint: the CMU skeleton's
        # sits about 10 cm above its hip joints, Rocketbox's pelvis level with them)
        frames.append(dict(rot=world, hips=(pose['thighL'][1] + pose['thighR'][1]) * (k / 2)))
        fsrc += step
    bpy.data.objects.remove(src)
    bpy.data.actions.remove(act)
    log(name, f'{len(frames)} frames @ {FPS} fps from {n_src} source frames, scale {k:.4f}, hinges from the clip: {sorted(hinge)}')
    return frames


def to_local(fr):
    """World (armature-space) rotations of the semantic bones -> pose-bone basis quaternions."""
    return posed(fr)[0]


def posed(fr):
    """(pose-bone bases, armature-space bone matrices) of a frame. The root goes where it puts
    the point between the hip joints at fr['hips']."""
    pose = {}
    basis = {}
    for name in order:
        b = tb[name]
        rest = T_rest[name]
        if b.parent:
            P = pose[b.parent.name]
            base = P @ T_rest[b.parent.name].inverted() @ rest  # where it sits with an identity basis
        else:
            base = rest.copy()
        sem = sem_of.get(name)
        if sem:
            q = fr['rot'][sem]
        elif name in BLEND:
            a, c = BLEND[name]
            q = fr['rot'][a] @ T_rest[TGT[a]].to_quaternion().inverted() @ rest.to_quaternion()
            q = q.slerp(fr['rot'][c] @ T_rest[TGT[c]].to_quaternion().inverted() @ rest.to_quaternion(), 0.5)
        else:
            q = None
        if q is None:
            M = base
        else:
            M = Matrix.Translation(base.translation) @ q.to_matrix().to_4x4()
            if b.parent is None:
                M = Matrix.Translation(fr['hips']) @ q.to_matrix().to_4x4()
        pose[name] = M
        B = base.inverted() @ M
        basis[name] = (B.to_quaternion(), B.translation.copy())
    # move the root (and with it everything) so the hip joints land where the source's are
    mid = (pose[TGT['thighL']].translation + pose[TGT['thighR']].translation) / 2
    shift = Matrix.Translation(fr['hips'] - mid)
    pose = {n: shift @ M for n, M in pose.items()}
    for name in order:
        if tb[name].parent is None:
            B = T_rest[name].inverted() @ pose[name]
            basis[name] = (B.to_quaternion(), B.translation.copy())
    return basis, pose


def ground(frames):
    """Lower (or raise) a clip so the feet meet the floor: at its lowest, a foot is as high as
    it is standing in the rest pose (ankle or toe joint, whichever is lower relative to its
    rest height, so a heel or toe contact counts). Returns the change and the median gap."""
    keys = ('footL', 'footR', 'toeL', 'toeR')
    gaps = []
    for fr in frames:
        P = posed(fr)[1]
        gaps.append(min(P[TGT[k]].translation.z - T_head[k].z for k in keys))
    dz = min(gaps)
    for fr in frames:
        fr['hips'] = fr['hips'] - Vector((0, 0, dz))
    return dz, float(np.median(gaps)) - dz


def hips_track(frames):
    return np.array([[f['hips'].x, f['hips'].y, f['hips'].z] for f in frames])


def features(frames):
    rows = []
    prev = {}
    for f in frames:
        r = []
        for key in ('spine', 'chest', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR'):
            q = f['rot']['hips'].inverted() @ f['rot'][key]
            # keep the sign continuous through the clip (q and -q are the same rotation); a
            # fixed rule like w >= 0 flips mid-clip for joints near 180 degrees from the hips
            if (prev[key].dot(q) if key in prev else q.w) < 0:
                q = -q
            prev[key] = q
            r += [q.w, q.x, q.y, q.z]
        r.append(f['hips'].z * 3)
        rows.append(r)
    return np.array(rows)


def best_loop(frames, lmin, lmax, margin):
    F = features(frames)
    vel = np.gradient(hips_track(frames), axis=0)
    best = None
    n = len(frames)
    for L in range(lmin, min(lmax, n - 2 * margin) + 1):
        for s in range(margin, n - L - margin // 2):
            d = np.linalg.norm(F[s] - F[s + L]) + 4 * np.linalg.norm(vel[s] - vel[s + L])
            if best is None or d < best[0]:
                best = (d, s, L)
    return best


def yaw_of(v):
    return math.atan2(v[1], v[0])


def facing_fix(fr):
    """Rotation about Z that turns the hips of this frame to face -Y."""
    d = fr['rot']['hips'] @ T_rest[TGT['hips']].to_quaternion().inverted()
    lat = d @ (T_head['thighR'] - T_head['thighL'])
    fwd = Vector((0, 0, 1)).cross(lat)  # hips' forward, horizontal
    return -math.pi / 2 - math.atan2(fwd.y, fwd.x)


def make_cycle(frames, s, L, inplace=True):
    """Cut frames[s:s+L] into a loop: cross-fade the end into the frames before s, remove the
    average travel (keeping sway and bob) and turn the travel direction to face -Y (the
    avatar's forward). A clip that doesn't travel is turned so the hips face -Y."""
    H = hips_track(frames)
    travel = H[s + L, :2] - H[s, :2]
    ang = -math.pi / 2 - yaw_of(travel) if np.linalg.norm(travel) > 0.05 else facing_fix(frames[s])
    R = Quaternion((0, 0, 1), ang)
    K = min(8, s, L // 3)
    out = []
    for i in range(L):
        f = frames[s + i]
        rot = dict(f['rot'])
        hips = f['hips'].copy()
        j = i - (L - K)
        if j >= 0:
            # blend toward frame s - K + j, shifted forward by one loop of travel
            w = (j + 1) / (K + 1)
            w = w * w * (3 - 2 * w)
            g = frames[s - K + j]
            rot = {key: rot[key].slerp(g['rot'][key], w) for key in rot}
            gh = g['hips'] + Vector((travel[0], travel[1], 0))
            hips = hips.lerp(gh, w)
        if inplace:
            lin = Vector((H[s, 0], H[s, 1], 0)) + Vector((travel[0], travel[1], 0)) * (i / L)
            hips = hips - lin
        hips = R @ hips
        rot = {key: R @ q for key, q in rot.items()}
        out.append(dict(rot=rot, hips=hips))
    speed = float(np.linalg.norm(travel)) / (L / FPS)
    return out, speed


def write_action(name, frames, loop):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for i, fr in enumerate(frames):
        basis = to_local(fr)
        for bn, (q, t) in basis.items():
            if bn not in sem_of and bn not in BLEND:
                continue  # fingers and face stay at rest; keeps the file small
            pb = arm.pose.bones[bn]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=i + 1, group=bn)
            if tb[bn].parent is None:
                pb.location = t
                pb.keyframe_insert('location', frame=i + 1, group=bn)
    # quaternion continuity (no flips between keys) is handled by the exporter's sampling
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    track.mute = True
    return act


# degrees to raise the head (the idle actor looks at the floor)
HEAD_LIFT = {'idle': 24}


def lift_head(frames, deg):
    for f in frames:
        d = f['rot']['chest'] @ T_rest[TGT['chest']].to_quaternion().inverted()
        lat = d @ (T_head['armR'] - T_head['armL'])
        for key, share in (('neck', 0.45), ('head', 1.0)):
            f['rot'][key] = Quaternion(lat.normalized(), math.radians(deg * share)) @ f['rot'][key]


meta = {}
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
for name, (file, kind, t0, t1, mode) in CLIPS.items():
    if ONLY and name not in ONLY:
        continue
    frames = sample_clip(name, file, kind, t0, t1)
    if name in HEAD_LIFT:
        lift_head(frames, HEAD_LIFT[name])
    if mode == 'cycle':
        lmin, lmax = (int(0.8 * FPS), int(1.5 * FPS)) if name == 'walk' else (int(0.45 * FPS), int(1.0 * FPS)) if name.startswith(('run', 'sprint')) else (int(0.8 * FPS), int(2.6 * FPS))
        d, s, L = best_loop(frames, lmin, lmax, margin=min(10, len(frames) // 6))
        frames, speed = make_cycle(frames, s, L)
        log(name, f'loop at {s} len {L} ({L / FPS:.2f} s) err {d:.3f} speed {speed:.2f} m/s')
        meta[name] = dict(speed=round(speed, 3), duration=L / FPS)
    elif mode == 'whole':
        # the clip is a single cycle already
        L = len(frames) - 1
        F = features(frames)
        frames, speed = make_cycle(frames, 0, L)
        log(name, f'whole clip as a loop, len {L}, end-to-start error {np.linalg.norm(F[0] - F[L]):.3f}, speed {speed:.2f} m/s')
        meta[name] = dict(speed=round(speed, 3), duration=L / FPS)
    elif mode == 'idle':
        d, s, L = best_loop(frames, int(4 * FPS), int(9 * FPS), margin=10)
        frames, speed = make_cycle(frames, s, L)
        log(name, f'loop at {s} len {L} err {d:.3f}')
        meta[name] = dict(duration=L / FPS)
    else:
        H = hips_track(frames)
        ang = facing_fix(frames[0])
        R = Quaternion((0, 0, 1), ang)
        frames = [dict(rot={k2: R @ q for k2, q in f['rot'].items()}, hips=R @ (f['hips'] - Vector((H[0, 0], H[0, 1], 0)))) for f in frames]
        # jump timing, from the hip height: takeoff, apex and touchdown
        z = H[:, 2]
        base = float(np.median(z[:8]))
        low = int(np.argmin(z[: int(np.argmax(z))]))
        apex = int(np.argmax(z))
        off = next(i for i in range(low, apex) if z[i] > base)
        down = next((i for i in range(apex, len(z)) if z[i] < base), len(z) - 1)
        meta[name] = dict(duration=len(frames) / FPS, takeoff=off / FPS, apex=apex / FPS, land=down / FPS)
    if name != 'swim':  # the game floats the swim clip at the surface itself
        dz, gap = ground(frames)
        log(name, f'{"raised" if dz < 0 else "lowered"} {abs(dz) * 100:.1f} cm to the floor; median foot gap {gap * 100:.1f} cm')
    act = write_action(name, frames, mode != 'once')
    if mode == 'cycle' and name != 'swim':
        # where in the loop the left foot is furthest forward (its heel strike), so the game
        # can line up the walk, run and sprint cycles when it blends them
        arm.animation_data.action = act
        ys = []
        for i in range(len(frames)):
            bpy.context.scene.frame_set(i + 1)
            ys.append(arm.pose.bones[TGT['footL']].head.y - arm.pose.bones[TGT['footR']].head.y)
        arm.animation_data.action = None
        meta[name]['lfoot'] = round(int(np.argmin(ys)) / len(frames), 3)
    if name == 'swim':
        meta[name]['hips'] = round(float(np.mean([f['hips'].z for f in frames])), 3)

# ------------------------------------------------------------------ materials
# textures come from tools/character/textures.py (TEXDIR)
for mat in body.data.materials:
    stem = mat.name  # e.g. m022_body
    paths = {k: os.path.join(TEXDIR, f'{stem}_{k}.jpg') for k in ('color', 'normal', 'orm')}
    alpha = os.path.exists(os.path.join(TEXDIR, f'{stem}_color.png'))
    if alpha:
        paths['color'] = os.path.join(TEXDIR, f'{stem}_color.png')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    def img(pth, color=True):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(pth)
        n.image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        return n
    c = img(paths['color'])
    nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(c.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
    if os.path.exists(paths['normal']):
        n = img(paths['normal'], False)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if os.path.exists(paths['orm']):
        r = img(paths['orm'], False)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(r.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    else:
        bsdf.inputs['Roughness'].default_value = 0.6  # hair
    bsdf.inputs['Metallic'].default_value = 0.0

# ------------------------------------------------------------------ clothing mask
# For the Character panel's colors: which texels of the body texture are shirt (R), pants
# (G) or shoes (B). Each body face is assigned by the bone that moves it most; inside the
# shirt and pants regions, texels the color of the hands' skin are left out (bare forearms,
# legs under shorts). The game recolors masked texels to the chosen color, scaled by their
# brightness relative to the region's mean (kept in the .json), so folds and seams stay.
def clothing_mask(size=512):
    me = body.data
    bi = next(i for i, m in enumerate(me.materials) if m.name.endswith('_body'))
    groups = {g.index: g.name for g in body.vertex_groups}

    def region(bone):
        if any(k in bone for k in ('Foot', 'Toe')):
            return 2
        if any(k in bone for k in ('Thigh', 'Calf', 'Pelvis')):
            return 1
        if any(k in bone for k in ('Hand', 'Finger')):
            return 3  # skin
        return 0  # spine, neck, clavicles, arms
    col_img = next(n.image for n in me.materials[bi].node_tree.nodes if n.type == 'TEX_IMAGE' and n.image.name.endswith('_color.jpg'))
    W, H = col_img.size
    tex = np.empty(W * H * 4, np.float32)
    col_img.pixels.foreach_get(tex)
    tex = tex.reshape(H, W, 4)[:, :, :3]
    uv = me.uv_layers.active.data
    label = np.full((size, size), -1, np.int8)
    for p in me.polygons:
        if p.material_index != bi:
            continue
        w = {}
        for vi in p.vertices:
            for g in me.vertices[vi].groups:
                w[groups[g.group]] = w.get(groups[g.group], 0) + g.weight
        reg = region(max(w, key=w.get)) if w else 0
        pts = [uv[li].uv for li in p.loop_indices]
        for k in range(1, len(pts) - 1):  # fan into triangles, fill by barycentrics
            tri = np.array([pts[0], pts[k], pts[k + 1]]) * size
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
            (ax, ay), (bx, by), (cx, cy) = tri
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-9:
                continue
            l1 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / d
            l2 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / d
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
            sub = label[y0:y1 + 1, x0:x1 + 1]
            sub[inside] = reg
    # texture colors at mask resolution (Blender images are stored bottom row first, as UVs)
    ys = (np.arange(size) + 0.5) / size * H
    xs = (np.arange(size) + 0.5) / size * W
    small = tex[ys.astype(int)][:, xs.astype(int)]
    skin = np.median(small[label == 3], axis=0) if np.any(label == 3) else np.array([0.6, 0.45, 0.35])
    dist = np.linalg.norm(small - skin, axis=-1) / (np.linalg.norm(skin) + 1e-3)
    bare = dist < 0.18
    lum = small @ np.array([0.2126, 0.7152, 0.0722])
    mask = np.zeros((size, size, 4), np.float32)
    mask[..., 3] = 1
    stats = {}
    for ch, reg in ((0, 0), (1, 1), (2, 2)):
        m = (label == reg) & ~(bare & (reg != 2))
        mask[..., ch] = m
        stats[('shirt', 'pants', 'shoes')[ch]] = round(float(np.mean(lum[m])) if m.any() else 0.5, 4)
    img = bpy.data.images.new('clothing_mask', size, size, alpha=False)
    img.pixels.foreach_set(mask.ravel())
    pth = os.path.splitext(OUT)[0] + '_mask.png'
    img.filepath_raw = pth
    img.file_format = 'PNG'
    img.save()
    return stats


meta['clothing'] = clothing_mask()
log('clothing mask', meta['clothing'])

# ------------------------------------------------------------------ export
arm.animation_data.action = None
for t in arm.animation_data.nla_tracks:
    t.mute = False
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_anim_single_armature=True, export_force_sampling=True,
                          export_frame_step=1, export_optimize_animation_size=True, export_def_bones=False,
                          export_image_format='WEBP', export_image_quality=85, export_yup=True, export_apply=False)
import json
json.dump(meta, open(os.path.splitext(OUT)[0] + '.json', 'w'), indent=1)
if os.environ.get('KEEP_BLEND'):  # for inspecting the result in Blender
    bpy.ops.wm.save_as_mainfile(filepath=os.environ['KEEP_BLEND'])
log('saved', meta)
