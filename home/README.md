# Home 3D

A small walkable 3D model of an average single-family house: a three-bedroom, two-bath ranch with a hall bath, a primary suite, an open living and dining room, a galley kitchen and an attached two-car garage. It is about 2,150 sq ft including the garage. You start on the front walk, open the front door, and walk the house.

It is plain static files with [three.js](https://threejs.org/) loaded from a CDN, like the school model next to it. There is no build step.

## Run it

Serve the repository root (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/home/
```

It needs WebGL and a keyboard. Touch controls aren't implemented yet.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** or arrows | Walk |
| **Shift** | Run |
| **Space** | Jump (a quick tap works) |
| **E** | Open or close the nearest door or the garage door |
| **L** | Light switch (all rooms) |
| **V** | First or third person |
| **Mouse drag** (or double-click the view, then move the mouse) | Look |
| **Scroll** | Camera distance (third person) |
| **M** | Show or hide the floor plan (north is up, you are the red dot) |
| **H** | Show or hide the controls |

In a tight spot, with a wall right behind you, the camera moves to your head and looks forward so it doesn't clip into your body.

## Files

```
index.html          page shell, HUD, controls panel, import map
js/layout.js        the house as data: rooms, openings, furniture, lot
js/build.js         builds walls, doors, floors, ceilings, roof, furniture, yard, cars and lights
js/main.js          renderer, player movement and collision, camera, input, HUD, floor plan
```

## How the house is built

**Rooms are rectangles.** Each room in `ROOMS` (in `layout.js`) is `[x0, z0, x1, z1]` in meters. x runs east, z runs north, the front door is on the `z = 0` wall, and the street is at negative z. The rooms tile the footprint, so every wall is worked out automatically. Wherever two rooms meet, or a room meets the outside, a wall goes in. Exterior walls get siding on the outside and drywall inside.

**Openings are listed by hand.** `OPENINGS` cuts doors, arches, windows and the garage door into those walls. For example:

```js
{ axis: 'x', c: 4.0, a: 2.6, b: 3.4, kind: 'door' }   // a wall along x at z = 4.0, from x 2.6 to 3.4
```

`door` swings open with **E**, `arch` is an open gap, `window` has a frame and glass, and `garage` slides up when you press **E**. A door that doesn't line up with a wall logs a warning in the console.

**Furniture** is in `FURNITURE`: boxes, beds, sofas, chairs and tables, each with a rectangle and a height. Anything solid blocks walking.

**Stock files.** Floors, walls, ceilings and the lawn use the CC0 photo textures already in [`assets/textures/`](../assets/textures/CREDITS.md) (ambientCG). The two cars in the garage are the Kenney Car Kit models in [`assets/models/cars/`](../assets/models/cars/CREDITS.md). The tile floor and siding are generated on a canvas.

## Choices and what's approximate

- **One story.** A ranch keeps the model small and avoids a staircase. A second floor would mean a stair opening and an upper-floor version of `ROOMS`, so it's the next thing to add if you want it.
- **Dimensions are typical, not measured.** The house is 13 m × 12 m with 2.6 m ceilings. The garage is 6.5 m × 6.8 m.
- **Lighting** is a sun with shadows outside, plus a light in each room that the switch turns off. The roof hides when you go inside.
- **The yard** is flat: a lawn, a street, a sidewalk, a driveway, a front walk, a back patio, trees and shrubs. The lot edge keeps you on the property.

## Changing things

- Move a wall: change a room rectangle in `ROOMS`. Coordinates should be multiples of 0.1 m.
- Add a door or window: add an entry to `OPENINGS` on a wall that exists.
- Move furniture: edit `FURNITURE`.
- The browser console has `__home`, which can move the player and step the simulation at a fixed rate, for example `__home.step(2)` to advance two seconds.
