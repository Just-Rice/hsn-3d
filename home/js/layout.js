// The house as data. Everything is in meters: x runs east (right), z runs
// north (away from the street), and the street is at negative z. The front
// door is on the z = 0 wall.
//
// Rooms are rectangles [x0, z0, x1, z1] that tile the footprint. Walls are
// generated wherever two rooms meet, or a room meets the outside, so only
// openings (doors, arches, windows, the garage door) are listed by hand.
//
// Furniture types: box, bed, sofa, chair, table, rug. Box and rug are simple;
// the others are expanded into boxes by build.js. Materials are named in
// build.js (wood, light, white, fabric, counter, steel, tile...).

export const GRID = 0.1;      // wall raster size, meters; all coordinates are multiples of it
export const WALL_H = 2.6;    // ceiling height
export const GARAGE_H = 2.6;

export const HOUSE = { x0: 0, z0: 0, x1: 13, z1: 12 };
export const GARAGE = { x0: 13, z0: 0, x1: 19.5, z1: 6.8 };

export const ROOMS = [
  { id: 'bed2', name: 'Bedroom 2', rect: [0, 0, 4.0, 4.0], floor: 'carpet' },
  { id: 'bath2', name: 'Hall Bath', rect: [4.0, 0, 6.4, 4.0], floor: 'tile' },
  { id: 'entry', name: 'Entry', rect: [6.4, 0, 8.6, 4.0], floor: 'tile' },
  { id: 'bed3', name: 'Bedroom 3', rect: [8.6, 0, 13.0, 4.0], floor: 'carpet' },
  { id: 'hall', name: 'Hallway', rect: [0, 4.0, 13.0, 5.2], floor: 'wood' },
  { id: 'primary', name: 'Primary Bedroom', rect: [0, 5.2, 4.8, 12.0], floor: 'carpet' },
  { id: 'pbath', name: 'Primary Bath', rect: [4.8, 5.2, 7.2, 8.6], floor: 'tile' },
  { id: 'pcloset', name: 'Primary Closet', rect: [4.8, 8.6, 7.2, 12.0], floor: 'carpet' },
  { id: 'living', name: 'Living & Dining', rect: [7.2, 5.2, 13.0, 9.6], floor: 'wood' },
  { id: 'kitchen', name: 'Kitchen', rect: [7.2, 9.6, 13.0, 12.0], floor: 'tile' },
  { id: 'garage', name: 'Garage', rect: [13.0, 0, 19.5, 6.8], floor: 'concrete', garage: true },
];

// Openings are cut into the walls. axis 'x' means a wall along x at z = c;
// axis 'z' means a wall along z at x = c. a..b is the span along the wall.
// kinds: door (swings open with E), arch (open gap), window, garage (lifts with E).
export const OPENINGS = [
  // Exterior
  { axis: 'x', c: 0, a: 7.0, b: 7.9, kind: 'door', id: 'front' },
  { axis: 'x', c: 0, a: 0.9, b: 2.1, kind: 'window', bottom: 0.9 },
  { axis: 'x', c: 0, a: 4.9, b: 5.7, kind: 'window', bottom: 1.5, top: 2.2 },
  { axis: 'x', c: 0, a: 9.8, b: 11.4, kind: 'window', bottom: 0.9 },
  { axis: 'x', c: 0, a: 14.0, b: 18.8, kind: 'garage', top: 2.3, id: 'garage' },
  { axis: 'z', c: 0, a: 6.2, b: 7.8, kind: 'window', bottom: 1.2 },
  { axis: 'z', c: 13, a: 7.4, b: 8.8, kind: 'window', bottom: 0.9 },
  { axis: 'z', c: 13, a: 9.9, b: 10.9, kind: 'window', bottom: 0.9 },
  { axis: 'x', c: 12, a: 8.2, b: 10.4, kind: 'window', bottom: 1.4 },
  { axis: 'z', c: 19.5, a: 4.5, b: 5.8, kind: 'window', bottom: 1.0 },
  { axis: 'x', c: 6.8, a: 15.0, b: 17.0, kind: 'window', bottom: 1.0 },
  // Interior
  { axis: 'x', c: 4.0, a: 2.6, b: 3.4, kind: 'door' },   // Bedroom 2 - hall
  { axis: 'x', c: 4.0, a: 4.6, b: 5.4, kind: 'door' },   // Hall bath - hall
  { axis: 'x', c: 4.0, a: 6.8, b: 8.2, kind: 'arch' },   // Entry - hall
  { axis: 'x', c: 4.0, a: 9.4, b: 10.2, kind: 'door' },  // Bedroom 3 - hall
  { axis: 'x', c: 5.2, a: 3.2, b: 4.0, kind: 'door' },   // Primary - hall
  { axis: 'x', c: 5.2, a: 8.4, b: 9.8, kind: 'arch' },   // Hall - living
  { axis: 'z', c: 4.8, a: 6.0, b: 6.9, kind: 'door' },   // Primary - bath
  { axis: 'z', c: 4.8, a: 10.0, b: 10.8, kind: 'door' }, // Primary - closet
  { axis: 'x', c: 9.6, a: 8.4, b: 9.8, kind: 'arch' },   // Living - kitchen
  { axis: 'z', c: 13, a: 5.6, b: 6.6, kind: 'door' },    // Living - garage
];

// Furniture in plan coordinates. Heights are in meters from the floor.
// 'solid: false' items are decoration you can walk over.
export const FURNITURE = [
  // Bedroom 2
  { t: 'bed', r: [0.05, 1.1, 2.05, 2.9], head: 'x0', m: 'bedding' },
  { t: 'box', b: [0.05, 0, 0.3, 0.5, 0.55, 0.8], m: 'wood' },
  { t: 'box', b: [0.05, 0, 3.2, 0.5, 0.55, 3.7], m: 'wood' },
  { t: 'box', b: [3.45, 0, 0.5, 3.95, 0.9, 2.5], m: 'wood' },        // dresser
  { t: 'rug', r: [1.0, 0.8, 3.2, 3.3], m: 'rugBlue' },

  // Hall bath
  { t: 'box', b: [4.05, 0, 0.2, 4.85, 0.55, 1.7], m: 'tub' },
  { t: 'box', b: [5.85, 0, 0.6, 6.35, 0.42, 1.2], m: 'tub' },        // toilet bowl
  { t: 'box', b: [5.85, 0.42, 0.6, 6.35, 0.8, 0.85], m: 'tub' },     // toilet tank
  { t: 'box', b: [5.2, 0, 3.35, 6.35, 0.9, 3.95], m: 'wood' },       // vanity
  { t: 'box', b: [5.2, 0.9, 3.35, 6.35, 0.95, 3.95], m: 'counter' },

  // Entry
  { t: 'box', b: [8.15, 0, 1.2, 8.55, 0.9, 2.9], m: 'wood' },        // console table
  { t: 'box', b: [6.6, 0, 3.0, 7.0, 0.5, 3.4], m: 'plant' },          // plant pot
  { t: 'box', b: [6.5, 0.5, 2.9, 7.1, 1.0, 3.5], m: 'plant', solid: false },

  // Bedroom 3
  { t: 'bed', r: [10.95, 1.1, 12.9, 2.9], head: 'x1', m: 'bedding' },
  { t: 'box', b: [12.4, 0, 0.3, 12.9, 0.55, 0.8], m: 'wood' },
  { t: 'box', b: [12.4, 0, 3.2, 12.9, 0.55, 3.7], m: 'wood' },
  { t: 'rug', r: [9.4, 0.9, 10.7, 2.8], m: 'rugBlue' },

  // Primary bedroom
  { t: 'bed', r: [1.4, 9.9, 3.1, 11.9], head: 'z1', m: 'bedding' },
  { t: 'box', b: [0.6, 0, 11.1, 1.2, 0.6, 11.7], m: 'wood' },
  { t: 'box', b: [3.3, 0, 11.1, 3.9, 0.6, 11.7], m: 'wood' },
  { t: 'box', b: [0.05, 0, 6.2, 0.7, 0.9, 8.2], m: 'wood' },         // dresser
  { t: 'rug', r: [0.9, 8.6, 3.9, 9.8], m: 'rugGray' },

  // Primary bath
  { t: 'box', b: [5.5, 0, 5.25, 7.1, 0.55, 6.45], m: 'tub' },        // tub
  { t: 'box', b: [6.6, 0, 7.0, 7.15, 0.9, 8.4], m: 'wood' },         // double vanity
  { t: 'box', b: [4.85, 0, 7.3, 5.45, 0.42, 8.0], m: 'tub' },        // toilet

  // Primary closet
  { t: 'box', b: [7.0, 1.5, 9.0, 7.15, 1.6, 11.6], m: 'steel' },     // closet rod
  { t: 'box', b: [6.4, 0, 9.0, 7.15, 0.9, 9.6], m: 'wood' },         // shoe bench

  // Living and dining
  { t: 'box', b: [7.25, 0, 6.6, 7.75, 0.45, 8.0], m: 'dark' },        // TV stand
  { t: 'box', b: [7.22, 0.7, 6.8, 7.3, 1.45, 7.8], m: 'dark' },       // TV
  { t: 'sofa', r: [8.9, 6.3, 9.8, 8.7], back: 'x1', m: 'fabric' },
  { t: 'box', b: [8.25, 0, 7.0, 8.75, 0.45, 8.0], m: 'wood' },        // coffee table
  { t: 'rug', r: [7.9, 6.0, 10.0, 9.0], m: 'rugGray' },
  { t: 'table', r: [10.6, 6.2, 11.6, 8.6], m: 'wood' },
  { t: 'chair', r: [9.95, 6.3, 10.45, 6.8], back: 'z0', m: 'fabric' },
  { t: 'chair', r: [9.95, 7.2, 10.45, 7.7], back: 'z0', m: 'fabric' },
  { t: 'chair', r: [9.95, 8.1, 10.45, 8.6], back: 'z0', m: 'fabric' },
  { t: 'chair', r: [11.75, 6.3, 12.25, 6.8], back: 'z1', m: 'fabric' },
  { t: 'chair', r: [11.75, 7.2, 12.25, 7.7], back: 'z1', m: 'fabric' },
  { t: 'chair', r: [11.75, 8.1, 12.25, 8.6], back: 'z1', m: 'fabric' },

  // Kitchen: a galley along the back wall
  { t: 'box', b: [7.25, 0, 11.35, 12.2, 0.9, 11.95], m: 'wood' },    // base cabinets
  { t: 'box', b: [7.25, 0.9, 11.35, 12.2, 0.94, 11.95], m: 'counter' },
  { t: 'box', b: [9.7, 0.94, 11.45, 10.4, 0.96, 11.85], m: 'dark' },  // cooktop
  { t: 'box', b: [11.0, 0.94, 11.5, 11.5, 0.96, 11.85], m: 'steel' }, // sink
  { t: 'box', b: [12.25, 0, 11.2, 12.95, 1.9, 11.95], m: 'steel' },   // fridge

  // Garage: two cars go in (placed by build.js), plus a workbench
  { t: 'box', b: [19.05, 0, 1.0, 19.45, 0.9, 3.5], m: 'wood' },
];

// Lot and site, in meters. Surfaces are flat strips, so y stays at 0.
export const LOT = { x0: -9, z0: -16.5, x1: 28, z1: 25 };
export const STREET_Z = -18;      // street edge of the sidewalk
export const SIDEWALK_Z = -16.5;  // lawn starts here

export const YARD = {
  driveway: [13.6, -16.5, 19.0, 0],
  walk: [6.8, -16.5, 8.1, -1.2],
  stoop: [6.5, -1.2, 8.5, 0],
  patio: [2.0, 12.0, 10.5, 14.5],
  trees: [
    [-4, -4], [-5.5, 6], [-4.5, 15], [21.5, -3.5], [24.5, 7],
    [21, 18], [4, 21], [-7, -11], [26, -12], [-2, 22],
  ],
  // Low foundation shrubs along the front.
  shrubs: [[0.5, -0.6], [2.2, -0.6], [9.2, -0.6], [11.8, -0.6], [14.8, -0.6], [17.5, -0.6]],
  mailbox: [5.6, -16.1],
};

// Start on the front walk, facing the front door.
export const PLAYER_START = { x: 7.5, z: -5.5, yaw: Math.PI };
