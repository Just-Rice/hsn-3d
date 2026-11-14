# Player character

Builds `assets/models/people/student-*.glb` (+ `.json` clip timing) from a Rocketbox avatar
and motion capture. Needs Blender 4.x and Python 3 with Pillow and NumPy.

```sh
# 1. download an avatar from https://github.com/microsoft/Microsoft-Rocketbox
#    (Assets/Avatars/Adults/Male_Adult_17: Export/*.fbx and Textures/*.tga)
# 2. download the BVH clips listed in CLIPS in retarget.py into a folder, named
#    bn_<take>.bvh (Bandai Namco dataset 1) and cmu_<take>.bvh (CMU, from una-dinosauria/cmu-mocap)
python3 tools/character/textures.py Male_Adult_17/Textures /tmp/tex17
blender -b -P tools/character/retarget.py -- Male_Adult_17/Export/Male_Adult_17.fbx /tmp/tex17 mocap assets/models/people/student-m1.glb
```

Set `KEEP_BLEND=/tmp/x.blend` to also save the Blender scene for inspection. The retarget
method is described at the top of `retarget.py`; the game side is `src/avatar.js`.
