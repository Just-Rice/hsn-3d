# WW-P North 3D

A walkable 3D model of **West Windsor-Plainsboro High School North**, 90 Grovers Mill Road, Plainsboro, NJ, rebuilt from the school's printed first- and second-floor plans. Walk in through the front entrance, wander the A-wing, climb the stairwells to the 200s, stand on the theatre stage, swim laps in the pool, or head out to the football field.

**Play it:** https://just-rice.github.io/hsn-3d/

It runs in the browser with [three.js](https://threejs.org/). There is no build step and nothing to install.

## Play

| Keyboard / mouse | Touch |
| --- | --- |
| **W A S D** or arrows: walk | Left pad: walk |
| **Shift**: run | **RUN** button |
| **Space**: jump | **JUMP** button |
| **Mouse**: look (click the view to capture the mouse, or drag) | Drag anywhere: look |
| **Wheel**: zoom the camera | |
| **M** map · **F** find a room · **T** quick travel · **V** first/third person · **C** character · **H** hide help | Buttons under the minimap |

- **Find a room** (F): type `214`, `A104`, `305`, `pool`, `library`… and follow the red dots. Routes go through the real hallways and take the stairs when the room is on the other floor.
- **Campus map** (M): switch between floors, click a room for directions, double-click to jump there.
- **Quick travel** (T): Main Hall, Main Office, Media Center, courtyard, theatre stage, pool deck, gyms, the 2nd floor, the football stadium and more.
- **Character** (C): pick your shirt, pants, hair, skin, shoes and backpack colors. Choices are saved in your browser.
- The HUD counts how many of the numbered rooms you have visited.

## Run it locally

Any static web server works (ES modules don't load from `file://`):

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL. three.js is loaded from the jsDelivr CDN through the import map in `index.html`.

### GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The game is plain static files (`.nojekyll` is included), so it works as-is.

## How the school was rebuilt

**Floor plans.** Each photo in [`docs/`](docs/) is one floor:

- `floorplan-first-floor.jpg` is the **1st floor**: the A100s, the 100s, 300s and 400s, Main Hall, Media Center, Main Office, theatre, 300 lecture hall, student dining, pool, main and auxiliary gyms.
- `floorplan-second-floor.jpg` is the **2nd floor**: the A200s and rooms 200–229.

Every room is transcribed in [`src/layout.js`](src/layout.js) as rectangles in "plan units" (pixels measured on a de-skewed photo of the first-floor sheet), converted to meters with `S = 0.145 m/unit`. That scale makes the pool a 25-yard, six-lane pool, which is exactly what North has, and the main gym about 31 × 36 m. Doors are listed per room (`'E:0.3:2.0'` = east wall, 30% along, 2 m wide). The walls, door openings, floors, ceilings, brick exterior, windows and roofs are all generated from that data.

**Second floor.** The second-floor sheet is drawn at about twice the scale of the first-floor sheet and covers only the academic wing, so it was fitted onto that wing. Its notch at the bottom center sits over the Media Center roof, and rooms 221–228 stack over 111–120 the same way they do on paper. The five stairwells (NW, N, W, E, SE) are switchback stairs at the same spots on both floors.

**The school.** From web research:
- High School North opened in **September 1997**. An addition was built in **2000** (probably the A-numbered wing on the plans), and the first class graduated in 2002. The building is about **240,000 sq ft** on an **80-acre** tract on Grovers Mill Road, **across from Community Middle School** ([Wikipedia](https://en.wikipedia.org/wiki/West_Windsor-Plainsboro_High_School_North)).
- Colors are **royal blue and silver**, and the teams are the **Northern Knights** ([Wikipedia](https://en.wikipedia.org/wiki/West_Windsor-Plainsboro_High_School_North), [MaxPreps](https://www.maxpreps.com/nj/plainsboro/west-windsor-plainsboro-north-knights/)).
- The pool is a **full-size, year-round indoor pool, 25 yards with 6 lanes**. Plainsboro Township and the YWCA Princeton run their swim programs there ([Plainsboro Recreation](https://anc.apm.activecommunities.com/plainsboronj/activity/search/detail/2509?onlineSiteId=0&from_original_cui=true&locale=en-US)).
- The 2018 referendum paid for a performing-arts space and dance studio addition, a Media Center renovation, a culinary arts classroom and new science labs ([Community News](https://communitynews.org/sections/news/facilities-referendum-approved/), [NEW ROAD Construction](https://newroadcm.com/west-windsor-plainsboro-regional-school-district-high-school-north/)). This model follows the older floor plan, so those changes aren't included.

### What's approximate

- The plans are photocopies with no scale bar, so dimensions are fitted, not surveyed.
- Rooms the plans leave unlabeled are named generically (Office, Storage, Restroom), and furniture is a best guess (classroom desks, lab benches, lockers along the hallways).
- I couldn't find a readable photo or description of the facade, so the look is a guess: red-brown brick wings with window bands and a light stone coping. The flat roofs, one- and two-story massing and tall gym, theatre and natatorium volumes come from the plans.
- The paper plans stop at the building walls, so the site is invented apart from what's sourced above: the parking lot, bus loop, tennis courts and football stadium positions are placeholders, and Community Middle School is a simple stand-in block. Compass directions are "plan north" (the top of the sheet).

## Project layout

```
index.html        page shell, HUD and menus
src/layout.js     the floor plans as data (edit this to fix a room)
src/building.js   walls, doors, floors, ceilings, stairs, brick skin, windows, roofs, pool, signs
src/furniture.js  desks, labs, theatre seats, gyms, cafeteria, library, lockers
src/exterior.js   road, parking, flagpole, monument sign, stadium, tennis courts, trees
src/player.js     character model, movement physics, follow camera
src/physics.js    box colliders in a spatial hash, stairs and sunken floors
src/nav.js        A* pathfinding across both floors (stairwells link them)
src/map.js        minimap and campus map
src/textures.js   procedural textures (brick, block, tile, carpet, turf…) with no image files
tools/build-artifact.mjs  packages the page for a Claude Artifact preview
docs/             photos of the original floor-plan handout, one per floor
```

### Fixing a room

Open `src/layout.js`, find the room (for example `R('214', [484, 402, 528, 524], 'class', ['S'])`), and change its rectangle, type or doors. Coordinates are in plan units: x grows to the right on the plan and y grows downward. Reload the page to see the change.
