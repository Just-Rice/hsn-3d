# HSN 3D

A walkable 3D model of **West Windsor-Plainsboro High School North**, 90 Grovers Mill Road, Plainsboro, NJ, rebuilt from the school's printed first- and second-floor plans and laid out on the campus as it appears in satellite imagery. Walk in through the front entrance, wander the A-wing, climb the stairwells to the 200s, stand on the theatre stage, swim laps in the pool, shoot around in the gym, or head out to the stadium, tennis courts and practice fields.

**Play it:** https://just-rice.github.io/hsn-3d/

It runs in the browser with [three.js](https://threejs.org/). There is no build step and nothing to install.

## Play

| Keyboard / mouse | Touch |
| --- | --- |
| **W A S D** or arrows: walk | Left pad: walk |
| **Shift**: sprint · **Alt**: walk | **RUN** button · push the pad lightly to walk |
| **Space**: jump | **JUMP** button |
| **Mouse**: look (click the view to capture the mouse, or drag) | Drag anywhere: look |
| **Wheel**: zoom the camera | |
| **M** map · **F** find a room · **T** quick travel · **V** first/third person · **C** character · **G** settings · **H** hide help | Buttons under the minimap |

- **Find a room** (F): type `214`, `A104`, `305`, `pool`, `library`… and follow the red dots. Routes go through the real hallways and take the stairs when the room is on the other floor.
- **Campus map** (M): switch between floors, click a room for directions, double-click to jump there (or double-click anywhere outside).
- **Quick travel** (T): Main Hall, Main Office, Media Center, courtyard, theatre stage, pool deck, gyms, the 2nd floor, the stadium, tennis courts, practice fields, bus loop and parking.
- **Character** (C): recolor your top, pants, shoes and backpack. Choices are saved in your browser. (The realistic students below are built but switched off for now, `REALISTIC_STUDENTS` in `src/main.js`, so you play the simple figure.)
- The HUD counts how many of the numbered rooms you have visited.
- **Balls**: basketballs in both gyms, soccer balls on the practice fields and at the front walk, a football on the 50-yard line and a beach ball in the pool. Walk or run into them to kick them.
- **Swimming**: walk off the pool deck to swim. Space kicks you up, which also gets you back out at the wall.
- **Settings** (G): *Quality* Auto, Low, Medium, High or Ultra. Auto (the default) guesses from your graphics chip, then drops a level by itself if the game can't keep up, and remembers what worked. *Low* has no shadows, reflections, grass or post-processing and renders at 75% resolution, for Chromebooks and older laptops; *Medium* adds shadows, bloom, light reflections and grass; *High* adds ambient occlusion and sharper shadows and reflections; *Ultra* is everything at full resolution. *Frame rate* caps it at 30, 60 or no cap, and *Resolution* is Auto (lowered while the frame rate is low) or a fixed 50/75/100%. Press <kbd>`</kbd> to show the frame rate.
- **Map** (M): north is up. Drag to pan, scroll or pinch to zoom out to the whole campus.

## Run it locally

Any static web server works (ES modules don't load from `file://`):

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL. three.js and its add-ons (post-processing, sky) are loaded from the jsDelivr CDN through the import map in `index.html`.

### GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The game is plain static files (`.nojekyll` is included), so it works as-is.

## How the school was rebuilt

**Floor plans.** Each photo in [`docs/`](docs/) is one floor:

- `floorplan-first-floor.jpg` is the **1st floor**: the A100s, the 100s, 300s and 400s, Main Hall, Media Center, Main Office, theatre, 300 lecture hall, the Upper and Lower Dining Halls (UDH and LDH, "upper/lower student dining" on the plan), pool, main and auxiliary gyms.
- `floorplan-second-floor.jpg` is the **2nd floor**: the A200s and rooms 200–229.

Every room is transcribed in [`src/layout.js`](src/layout.js) as rectangles in "plan units" (pixels measured on a de-skewed photo of the first-floor sheet), converted to meters with `S = 0.18 m/unit`. That scale was fitted to the satellite footprint: the whole building comes out about 225 × 180 m and the academic wing about 98 × 83 m, the same as on the photo. The Main Hall is widened to about 12 m, and everything below it on the plan sheet is shifted down to make room. Doors are listed per room (`'E:0.3:2.0'` = east wall, 30% along, 2 m wide). The walls, door and window openings, floors, ceilings, brick exterior, roofs and stairs are all generated from that data.

**Second floor.** The second-floor sheet is drawn at about twice the scale of the first-floor sheet and covers only the academic wing, so it was fitted onto that wing. Its notch at the bottom center sits over the Media Center roof, and rooms 221–228 stack over 111–120 the same way they do on paper. The five stairwells (NW, N, W, E, SE) are switchback stairs at the same spots on both floors.

**The school.** From web research:
- High School North opened in **September 1997**. An addition was built in **2000** (probably the A-numbered wing on the plans), and the first class graduated in 2002. The building is about **240,000 sq ft** on an **80-acre** tract on Grovers Mill Road, **across from Community Middle School** ([Wikipedia](https://en.wikipedia.org/wiki/West_Windsor-Plainsboro_High_School_North)).
- Colors are **royal blue and silver**, and the teams are the **Northern Knights** ([Wikipedia](https://en.wikipedia.org/wiki/West_Windsor-Plainsboro_High_School_North), [MaxPreps](https://www.maxpreps.com/nj/plainsboro/west-windsor-plainsboro-north-knights/)).
- The pool is a **full-size, year-round indoor pool, 25 yards with 6 lanes**. Plainsboro Township and the YWCA Princeton run their swim programs there ([Plainsboro Recreation](https://anc.apm.activecommunities.com/plainsboronj/activity/search/detail/2509?onlineSiteId=0&from_original_cui=true&locale=en-US)).
- The 2018 referendum paid for a performing-arts space and dance studio addition, a Media Center renovation, a culinary arts classroom and new science labs ([Community News](https://communitynews.org/sections/news/facilities-referendum-approved/), [NEW ROAD Construction](https://newroadcm.com/west-windsor-plainsboro-regional-school-district-high-school-north/)). This model follows the older floor plan, so those changes aren't included.

**The campus.** The site in [`src/exterior.js`](src/exterior.js) is traced from a satellite view of the school. Features are written in photo pixel coordinates and converted with `sat()`, calibrated so the model's footprint lands on the real building (about 0.56 m per pixel east-west and 0.61 m north-south, which also matches the running track and tennis courts). The plan's top edge faces west, so the main entrance faces south onto the bus loop and the gyms are at the north end. Traced from the photo:

- Grovers Mill Road along the south edge, the bus loop along the front, the west access road to the field house cul-de-sac, and the ring road around the north of the building.
- The west student lot, the south bus lot, the east lot and the service yard behind the kitchen.
- The stadium north-west of the building: a regulation 400 m track, the football field, home grandstand and press box on the north side, visitor bleachers on the south.
- **Six tennis courts** in an L west of the west lot (two on top, four below).
- The practice fields to the north: soccer, field hockey, the softball and baseball diamonds and a lined practice field.
- The woods and creek to the north-east, the tree line along the west edge, and Community Middle School across Grovers Mill Road.

**Graphics.** Materials are physically based (`src/materials.js`) with procedural color and normal maps (`src/textures.js`). The sky is a physical sky model that also lights the scene through image-based lighting outdoors; indoors a neutral room environment takes over. The sun casts soft shadows; indoors the shadow map covers the whole building so rooms far down a hallway are still shaded by the roof. The waxed hallway tile, the gym floor and the stage reflect the room: a mirrored render at the height of the floor you stand on, blurred by the finish and rippled by the floor's normal map (`src/reflect.js`). The post-processing chain is ambient occlusion (GTAO), bloom, a light vignette and Khronos PBR Neutral tone mapping, which keeps paint and brick colors true.

**Materials.** Inside, the walls are painted cinder block (7 × 14 in units with a pitted face and concave joints). Outside is king-size brick in running bond; the mortar is close to the brick color, so a joint reads as a shallow groove with a thin light edge, as in the photos, and a soldier course runs just below the coping. Ceiling tile, carpet, the gym's maple floor, concrete, asphalt and grass are photo-scanned CC0 textures from [ambientCG](https://ambientcg.com) (see [`assets/textures/CREDITS.md`](assets/textures/CREDITS.md)); they stream in over procedural stand-ins.

**The player.** The realistic students (switched off for now) are Microsoft's [Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatars (MIT), with real motion capture: walking from the [Bandai Namco Research Motion dataset](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset) (CC BY-NC 4.0), standing, jogging, sprinting, jumping and swimming from the [CMU motion capture database](http://mocap.cs.cmu.edu/). [`tools/character`](tools/character) retargets the clips onto the avatar in Blender, cuts them into seamless loops and exports a glTF; [`src/avatar.js`](src/avatar.js) blends walk, jog and sprint by speed on a shared, heel-strike-aligned phase so the feet don't slide, times the jump to the game's physics, and recolors clothes through a mask made in Blender. Movement speeds match the capture (a 3.4 m/s jog, 5.6 m/s sprint, 1.4 m/s walk). See [`assets/models/people/CREDITS.md`](assets/models/people/CREDITS.md).

**Furniture, doors and lights.** Lockers (louvers, recessed handle, hasp, number plate, toe kick), student desks, shell chairs, lab stools, theatre seats, cafeteria tables, the wall clock, the oak classroom doors (vision lite, lever handles, kick plates, hinges, closer), 2×4 prismatic troffers and the backpack are modeled in Blender by [`tools/props/build_props.py`](tools/props/build_props.py) with PBR materials from ambientCG and a baked ambient-occlusion map each, then instanced over the simple shapes, which stay as a fallback. They are culled by 24 m cell and distance, and get an indoor fill light matching the lightmapped walls.

**Vehicles.** Sedans, hatchbacks, SUVs, minivans, pickups, box trucks and Type C school buses are lofted in Blender from side and plan profiles ([`tools/vehicles/build_vehicles.py`](tools/vehicles/build_vehicles.py)), with glass, light clusters, grilles, plates, handles and door seams placed on the body by ray casting, cut wheel arches and five-spoke wheels; clearcoat paint takes each car's color.

**Grass.** Tufts of grass blades wrap around the camera on the lawns, masked by a top-down render of the lawn made at load, thinning with distance and moving in the wind (`src/grass.js`). The practice fields and stadium turf get the photo grass's fine detail in world space.

**Sky.** A photographed partly cloudy sky ([Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), CC0) is the backdrop and lights the outdoors; the sun direction comes from the photo. Trees are Poly Haven tree models (CC0) rendered into sprites in Blender ([`tools/bake/tree_sprites.py`](tools/bake/tree_sprites.py)) and drawn as crossed billboards, so the woods can hold thousands of them.

**Baked lighting.** The light from all ~1,400 ceiling fixtures, the daylight coming in through the windows and doors, and the sun's bounce light are baked into lightmaps with Blender's Cycles path tracer, so every room and hallway has soft light pools and light bouncing off the walls, not just the area around you. Direct sunlight stays real-time so shadows still move with you. The game uses the lightmaps only if they were baked from exactly the current geometry (it checks a fingerprint); otherwise it falls back to real-time lighting. See [Rebaking the lighting](#rebaking-the-lighting).

### What's approximate

- The plans are photocopies with no scale bar, so dimensions are fitted, not surveyed.
- Heights aren't on the plans, so they are measured from 2026 photos using the brick as a ruler: the bricks are king-size (a joint-to-joint length 3.36 times the course height), so one course is 7.62 cm. The one-story wings come out 5.0 m to the top of the coping (65 to 67 courses, on two photos), the entrance canopy's soffit 3.8 m (50 courses) and its top about 5.4 m, the canopy columns about 0.72 m across, and the ribbon windows run from 1.6 m to 2.35 m above the ground. The canopy's layout comes from fitting a camera to the photo's seven visible columns: two rows of four, 3.75 m apart, the back row against the 300s wing's wall and the front row 4.4 m further out. The same fit puts the ground edges in front of the 300s wing: a 2.3 m mulch bed, about 4 m of lawn, a 1.8 m sidewalk, then the bus lane (the satellite view agrees within a meter). Inside, the walls are 23 courses of 7 in block from floor to ceiling, as counted at the school, so classrooms, offices and hallways have 4.09 m ceilings under a 4.6 m roof deck, doors are 7 ft (12 courses), and the two-story wing is 27 courses (4.80 m) floor to floor with its parapet at 9.8 m. The player is 5 ft 7 in (1.70 m), the average height at the school. The gyms, natatorium, theatre and stage house are typical heights for a high school, not measured.
- Rooms the plans leave unlabeled are named generically (Office, Storage, Restroom), and furniture is mostly a best guess (classroom desks, lab benches, lockers along the hallways). The dining halls have round tables with curved benches, as they did in real life.
- The facade follows 2026 photos of the entrance and the 300s wing, plus a [2015 photo of the front](https://commons.wikimedia.org/wiki/File:WWPHS_North_front.jpg) (by Mr. Matté, CC BY 3.0): muted red-brown running-bond brick with thin light joints, a soldier course just below a light metal coping, vertical control joints, high ribbon windows with white aluminum frames, and the canopy with its white trim, brick fascia, white metal letters and round white columns. Sides nobody has photographed are assumed to match. The flat roofs, one- and two-story massing and tall gym, theatre and natatorium volumes come from the plans.
- The site is traced by eye from one satellite image, so positions are good to a few meters. Community Middle School is a simple stand-in block, and cars, buses and trees are placed to look like the photo rather than copied one by one.
- The map and minimap use true north (the top of the paper plans points west).

## Project layout

```
index.html        page shell, HUD and menus
src/layout.js     the floor plans as data (edit this to fix a room)
src/building.js   walls, doors, floors, ceilings, stairs, brick skin, windows, roofs, pool, signs
src/furniture.js  desks, labs, theatre seats, gyms, cafeteria, library, lockers
src/exterior.js   the campus, traced from satellite imagery: roads, lots, stadium, tennis, fields, woods
src/materials.js  shared physically based materials
src/balls.js      kickable balls (basketballs, soccer balls, a football, a beach ball)
src/player.js     movement physics (coyote time, jump buffering, swimming), follow camera, the simple stand-in figure
src/avatar.js     the realistic player: motion-capture playback and blending, clothing colors, backpack
src/props.js      swaps in the Blender furniture, doors and lights; culling and indoor fill light
src/reflect.js    planar floor reflections
src/grass.js      grass blades on the lawns
src/physics.js    box colliders in a spatial hash, stairs and sunken floors
src/nav.js        A* pathfinding across both floors (stairwells link them)
src/map.js        minimap and campus map (north-up)
src/textures.js   procedural textures and normal maps (brick, block, tile, carpet, turf…) with no image files
src/lightmap.js   lightmap UV atlas for the walls, floors and ceilings, and the lightmap loader
lightmaps/        baked lighting (2048² pages at 10 cm per texel, and a manifest)
assets/           textures, the sky, tree sprites, and the models: people, props, vehicles (credits in each folder)
tools/bake/       scene export (Playwright) and the Blender bake + encode scripts
tools/character/  avatar textures, motion-capture retargeting and export (Blender)
tools/props/      furniture, doors, light fixtures, backpack (Blender)
tools/vehicles/   cars, trucks, school buses (Blender)
tools/build-artifact.mjs  packages the page for a Claude Artifact preview
docs/             photos of the original floor-plan handout, one per floor
```

### Rebaking the lighting

After changing the building (anything in `src/layout.js` or `src/building.js`), the old lightmaps no longer match and the game quietly ignores them. To bake new ones you need Node, Playwright and Blender 4.x (or the `bpy` module from PyPI, which needs Python 3.11):

```sh
npm i -D playwright && npx playwright install chromium
node tools/bake/export.mjs                               # writes tools/bake/out/scene.*
blender -b -P tools/bake/bake.py -- tools/bake/out lightmaps 64
# or: pip install bpy pillow numpy && python tools/bake/bake.py tools/bake/out lightmaps 64
```

Blender's bundled Python needs Pillow for the final encode step: `<blender>/Contents/Resources/4.x/python/bin/python3.11 -m pip install pillow` (or encode afterwards with `python tools/bake/encode.py tools/bake/out lightmaps`, which skips the OIDN denoiser). The last number is Cycles samples per texel; The bake uses the GPU when Blender finds one (Metal, OptiX, CUDA, HIP). The export uses the simple stand-in furniture and cars, which are plenty for the light. To rebalance the fixtures, sky and sun without baking again, run `python tools/bake/encode.py tools/bake/out lightmaps 0.38 1 1`.

### Fixing a room

Open `src/layout.js`, find the room (for example `R('214', [484, 402, 528, 524], 'class', ['S'])`), and change its rectangle, type or doors. Coordinates are in plan units: x grows to the right on the plan and y grows downward. Reload the page to see the change.
