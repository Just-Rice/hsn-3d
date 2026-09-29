// Building layout transcribed from the West Windsor-Plainsboro High School North
// floor plans (first + second floor handout). The A-numbered wing is most likely the
// 2000 addition.
//
// All rectangles are written in "plan units": pixel coordinates measured on an upright,
// de-skewed copy of the first-floor sheet. `S` converts plan units to meters. The second
// floor sheet was drawn at a different scale, so its rooms were re-fitted onto the
// academic wing footprint (its bottom-center notch lines up with the Media Center roof,
// and rooms 221-228 stack over 111-118 exactly as on the paper plans).

// 0.18 m/unit matches the satellite footprint (whole building ≈ 225 × 180 m; academic wing ≈ 98 × 83 m).
export const S = 0.18; // meters per plan unit
const OX = 180;
const OY = 200;

export const LEVEL_H = 4.2; // floor-to-floor height
export const SLAB = 0.3;
export const CEIL2 = [3.4, 7.6]; // ceilings on level 0 and level 1 in the two-story wing
export const DOOR_H = 2.2;

export const wx = (px) => (px - OX) * S;
export const wz = (py) => (py - OY) * S;
export const rectW = (r) => [wx(r[0]), wz(r[1]), wx(r[2]), wz(r[3])];

// ---------------------------------------------------------------------------------------
// Massing blocks: footprint rectangles with roof/ceiling heights. Used for floors,
// ceilings, roofs and the brick exterior skin.
// ---------------------------------------------------------------------------------------
export const BLOCKS = [
  {
    id: 'acad', name: 'Academic Wing', levels: 2, roof: 8.4,
    rects: [
      [290, 208, 752, 345], [290, 345, 375, 402], [665, 345, 752, 402],
      [290, 402, 752, 630], [290, 630, 431, 750], [606, 630, 752, 750],
    ],
  },
  { id: 'mc', name: 'Media Center', levels: 1, ceil: 3.4, roof: 4.6, rects: [[431, 630, 606, 750]] },
  { id: 'office', name: 'Main Office', levels: 1, ceil: 3.4, roof: 4.6, rects: [[250, 455, 290, 750]] },
  { id: 'mainhall', name: 'Main Hall', levels: 1, ceil: 4.6, roof: 5.6, rects: [[238, 750, 1000, 798]] },
  { id: 'w300', name: '300s', levels: 1, ceil: 3.6, roof: 4.8, rects: [[217, 798, 363, 1175]] },
  { id: 'theatre', name: 'Theatre', levels: 1, ceil: 10, roof: 11, windows: false, rects: [[363, 798, 526, 990]] },
  { id: 'stage', name: 'Stage', levels: 1, ceil: 14, roof: 15, windows: false, rects: [[363, 990, 526, 1100]] },
  { id: 'backstage', name: 'Backstage', levels: 1, ceil: 4.5, roof: 5.5, rects: [[363, 1100, 526, 1175]] },
  { id: 'e300', name: '300s', levels: 1, ceil: 3.6, roof: 4.8, rects: [[526, 798, 621, 1183]] },
  { id: 'dining', name: 'Dining Halls', levels: 1, ceil: 5.5, roof: 6.5, rects: [[661, 798, 771, 990], [876, 798, 988, 967]] },
  { id: 'kitchen', name: 'Kitchen', levels: 1, ceil: 3.6, roof: 4.8, rects: [[771, 798, 876, 967], [771, 967, 929, 990], [732, 990, 929, 1105]] },
  { id: 'connector', name: 'Gym Connector', levels: 1, ceil: 3.2, roof: 4.2, rects: [[988, 826, 1027, 862]] },
  { id: 'pool', name: 'Natatorium', levels: 1, ceil: 8.0, roof: 9.0, windows: false, rects: [[752, 576, 962, 750]] },
  { id: 'lockers', name: 'Locker Rooms', levels: 1, ceil: 3.4, roof: 4.6, rects: [[962, 527, 1128, 750], [1128, 600, 1332, 750]] },
  { id: 'eastcorr', name: 'Gym Hallway', levels: 1, ceil: 3.4, roof: 4.6, rects: [[1000, 750, 1360, 778]] },
  { id: 'r400', name: '400s', levels: 1, ceil: 3.4, roof: 4.6, rects: [[1332, 600, 1456, 750], [1360, 750, 1456, 1026]] },
  { id: 'mgym', name: 'Main Gym', levels: 1, ceil: 9.5, roof: 10.5, windows: false, rects: [[1027, 778, 1241, 1026]] },
  { id: 'gymside', name: 'Gym Hallway', levels: 1, ceil: 3.4, roof: 4.6, rects: [[1241, 778, 1360, 1026], [1027, 1026, 1380, 1059], [1260, 1059, 1380, 1110]] },
  { id: 'sgym', name: 'Auxiliary Gym', levels: 1, ceil: 8.5, roof: 9.5, windows: false, rects: [[1045, 1059, 1260, 1220]] },
];

// The Main Hall is drawn narrow on the paper plan; it is widened by pushing everything south
// of it (and west of the gym wing) down by HALL_SHIFT plan units.
export const HALL_SHIFT = 16;
const HALL_X = 1000;
export const hy = (y) => (y >= 797 ? y + HALL_SHIFT : y);
const shiftRect = (r) => (r[0] < HALL_X ? [r[0], hy(r[1]), r[2], hy(r[3])] : r);
const shiftPt = (p) => (p[0] < HALL_X ? [p[0], hy(p[1])] : p);
export const MAIN_HALL_Y = 782; // plan y of the Main Hall centerline

export const COURTYARD = [375, 345, 665, 402];
export const PORCH = shiftRect([205, 735, 238, 810]); // covered main entrance (columns on the plan)
// 25-yard, six-lane competition pool, centered where the plan draws it
export const POOL = { cx: 859, cy: 645, len: 22.86, wid: 14.6 };
export const STAGE = shiftRect([363, 990, 526, 1100]);

// ---------------------------------------------------------------------------------------
// Rooms. door spec: 'E' | 'E:0.3' (fraction along side) | 'E:0.3:2.4' (width in m)
// stairs: type 'stair' with `open` = the side facing the hallway (switchback stairs).
// ---------------------------------------------------------------------------------------
const R = (label, r, type, doors = [], extra = {}) => ({ label, r, type, doors, ...extra });
const ST = (id, r, open) => ({ label: 'Stairs', id, r, type: 'stair', open, doors: [] });

export const ROOMS = [
  // ============================ FIRST FLOOR (level 0) ============================
  [
    // --- A-wing left column
    ST('NW', [290, 208, 352, 238], 'E'),
    R('A103', [290, 238, 352, 275], 'class', ['E']),
    R('A102', [290, 275, 352, 312], 'class', ['E']),
    R('A101', [290, 312, 352, 350], 'lab', ['E']),
    R('A100', [290, 350, 352, 425], 'lab', ['E']),
    ST('W', [290, 425, 352, 455], 'E'),
    // --- office suite
    R('Nurse', [250, 455, 352, 520], 'office', ['E'], { name: "Nurse's Office" }),
    R('Guidance', [250, 520, 352, 640], 'office', ['E'], { name: 'Guidance' }),
    R('Main Office', [250, 640, 352, 750], 'office', ['E', 'S:0.6:1.8'], { name: 'Main Office', big: true }),
    // --- A-wing top row
    R('A104', [375, 208, 425, 268], 'class', ['S']),
    R('A107', [425, 208, 470, 268], 'class', ['S']),
    R('A109', [470, 208, 540, 268], 'lab', ['S']),
    ST('N', [540, 208, 578, 268], 'S'),
    R('', [578, 208, 605, 268], 'storage', ['S'], { name: 'Storage' }),
    R('A112', [605, 208, 640, 268], 'class', ['S']),
    R('A114', [640, 208, 665, 268], 'class', ['S']),
    // --- A-wing inner row (north of the courtyard)
    R('A105', [375, 292, 425, 345], 'class', ['N']),
    R('A106', [425, 292, 465, 345], 'class', ['N']),
    R('A108', [465, 292, 502, 345], 'class', ['N']),
    R('A110', [502, 292, 545, 345], 'lab', ['N']),
    R('A111', [545, 292, 590, 345], 'lab', ['N']),
    R('A113', [590, 292, 665, 345], 'class', ['N']),
    // --- A-wing right column / 100s
    R('A115', [690, 208, 752, 245], 'class', ['W']),
    R('A116', [690, 245, 752, 280], 'class', ['W']),
    R('A117', [690, 280, 752, 318], 'class', ['W']),
    R('A118', [690, 318, 752, 360], 'class', ['W']),
    ST('E', [690, 360, 752, 395], 'W'),
    R('111', [690, 395, 752, 435], 'class', ['W']),
    R('112', [690, 435, 752, 480], 'class', ['W']),
    R('113', [690, 480, 752, 525], 'class', ['W']),
    R('114', [690, 525, 752, 566], 'class', ['W']),
    R('116', [690, 566, 752, 600], 'class', ['W']),
    R('118', [690, 600, 752, 626], 'office', ['W']),
    R('120', [690, 626, 752, 655], 'office', ['W']),
    R('', [690, 655, 752, 690], 'storage', ['W'], { name: 'Storage' }),
    ST('SE', [690, 690, 752, 725], 'W'),
    R('', [690, 725, 752, 750], 'storage', ['W'], { name: 'Custodian' }),
    // --- south of the courtyard
    R('', [375, 402, 405, 441], 'office', ['W'], { name: 'Office' }),
    R('', [375, 441, 405, 480], 'office', ['W'], { name: 'Office' }),
    R('106', [405, 402, 475, 480], 'class', ['S']),
    R('108', [475, 402, 590, 480], 'class', ['S:0.3', 'S:0.8']),
    R('', [590, 402, 630, 480], 'storage', ['S'], { name: 'Prep Room' }),
    R('', [630, 402, 665, 441], 'storage', ['E'], { name: 'Storage' }),
    R('', [630, 441, 665, 480], 'lav', ['E'], { name: 'Restroom' }),
    // --- 100s block around the Media Center
    R('', [375, 503, 431, 546], 'office', ['N'], { name: 'Office' }),
    R('102', [375, 546, 431, 600], 'class', ['W']),
    R('101', [375, 600, 431, 657], 'class', ['W']),
    R('100', [375, 657, 431, 700], 'class', ['W']),
    R('', [375, 700, 431, 750], 'lav', ['W'], { name: 'Restrooms' }),
    R('105', [431, 503, 484, 581], 'class', ['N']),
    R('107', [484, 503, 553, 558], 'class', ['N']),
    R('', [484, 558, 553, 581], 'office', ['S'], { name: 'Media Workroom' }),
    R('109', [553, 503, 606, 581], 'class', ['N']),
    R('Media Center', [431, 581, 606, 750], 'media', ['S:0.25:2.4', 'S:0.75:2.4'], { name: 'Media Center', big: true }),
    R('', [606, 503, 665, 522], 'office', ['N'], { name: 'Office' }),
    R('115', [606, 522, 665, 585], 'class', ['E']),
    R('117', [606, 585, 665, 651], 'class', ['E']),
    R('119', [606, 651, 665, 716], 'class', ['E']),
    R('', [606, 716, 665, 750], 'lav', ['E'], { name: 'Restroom' }),
    // --- 300s, lecture hall, theatre
    R('300', [217, 798, 337, 912], 'lecture', ['N:0.72:1.8', 'E:0.5'], { name: 'Lecture Hall 300' }),
    R('301', [217, 935, 290, 1005], 'music', ['E']),
    R('302', [217, 1005, 290, 1062], 'class', ['E']),
    R('303', [217, 1062, 290, 1175], 'art', ['E']),
    R('', [305, 935, 337, 1100], 'music', ['W', 'E'], { name: 'Practice Rooms' }),
    R('304', [305, 1100, 363, 1175], 'office', ['W', 'N:0.75']),
    R('Theatre', [363, 798, 526, 1100], 'theatre', ['N:0.2:2.4', 'N:0.8:2.4', 'W:0.09:1.8', 'E:0.09:1.8'], { name: 'Theatre', big: true }),
    R('', [363, 1100, 526, 1175], 'storage', ['N:0.15:2.4', 'W:0.5', 'E:0.5'], { name: 'Backstage' }),
    R('305', [543, 798, 621, 840], 'class', ['W']),
    R('306', [543, 840, 621, 874], 'class', ['W']),
    R('307', [543, 874, 621, 937], 'class', ['W']),
    R('308', [543, 937, 621, 1022], 'art', ['W']),
    R('309', [543, 1022, 621, 1054], 'class', ['W']),
    R('', [543, 1054, 621, 1100], 'storage', ['W'], { name: 'Storage' }),
    R('310', [543, 1100, 621, 1130], 'class', ['W']),
    R('', [543, 1130, 621, 1183], 'storage', ['W'], { name: 'Storage' }),
    // --- dining
    // the plan's "upper/lower student dining" are the Upper and Lower Dining Halls (UDH, LDH)
    R('UDH', [661, 798, 771, 990], 'dining', ['N:0.5:2.4', 'E:0.2:2.0'], { name: 'Upper Dining Hall', big: true }),
    R('', [771, 798, 876, 967], 'kitchen', ['W:0.2:2.0', 'E:0.2:2.0', 'N:0.5:2.0', 'S:0.5'], { name: 'Serving Line' }),
    R('LDH', [876, 798, 988, 967], 'dining', ['N:0.5:2.4', 'W:0.2:2.0', 'E:0.27:2.0'], { name: 'Lower Dining Hall', big: true }),
    R('', [771, 967, 929, 1105], 'kitchen', ['N:0.3'], { name: 'Kitchen' }),
    R('', [732, 990, 771, 1105], 'storage', ['E:0.5'], { name: 'Kitchen Storage' }),
    // --- pool + lockers
    R('Pool', [752, 576, 962, 750], 'pool', ['S:0.5:2.0', 'E:0.25', 'E:0.75'], { name: 'Pool', big: true }),
    R('', [962, 527, 1128, 576], 'office', ['S:0.8'], { name: 'Coaches Offices' }),
    R('', [962, 576, 1060, 663], 'locker', ['W', 'E'], { name: 'Pool Locker Room' }),
    R('', [962, 663, 1060, 750], 'locker', ['W', 'S'], { name: 'Pool Locker Room' }),
    R('', [1060, 576, 1128, 660], 'office', ['S', 'W', 'N:0.51'], { name: 'Training Room' }),
    R('', [1060, 660, 1128, 750], 'weights', ['S'], { name: 'Weight Room' }),
    R('', [1128, 600, 1225, 750], 'locker', ['S'], { name: "Boys' Locker Room" }),
    R('', [1225, 600, 1316, 750], 'locker', ['S'], { name: "Girls' Locker Room" }),
    // --- 400s
    R('400', [1332, 600, 1456, 644], 'class', ['W']),
    R('401', [1332, 644, 1456, 750], 'class', ['W']),
    R('', [1360, 750, 1456, 778], 'storage', ['W'], { name: 'Storage' }),
    R('402', [1360, 778, 1456, 888], 'class', ['W']),
    R('403', [1360, 888, 1456, 921], 'office', ['W']),
    R('404', [1360, 921, 1456, 972], 'class', ['W']),
    R('405', [1360, 972, 1456, 1026], 'class', ['W']),
    // --- gyms
    R('Main Gym', [1027, 778, 1241, 1026], 'gym', ['N:0.25:2.4', 'N:0.75:2.4', 'S:0.3:2.4', 'S:0.7:2.4', 'W:0.33:2.0', 'E:0.2:1.6'], { name: 'Main Gym', big: true }),
    R('', [1241, 778, 1343, 880], 'locker', ['E', 'W'], { name: 'Team Locker Room' }),
    R('', [1241, 880, 1343, 940], 'office', ['E'], { name: 'Athletic Office' }),
    R('', [1241, 940, 1343, 1026], 'locker', ['E', 'S'], { name: 'Team Room' }),
    R('', [1260, 1059, 1380, 1110], 'storage', ['N'], { name: 'Equipment Storage' }),
    R('Gym', [1045, 1059, 1260, 1220], 'gym', ['N:0.3:2.4', 'N:0.7:2.4'], { name: 'Auxiliary Gym', big: true }),
  ],
  // ============================ SECOND FLOOR (level 1) ============================
  [
    ST('NW', [290, 208, 352, 238], 'E'),
    R('A203', [290, 238, 352, 270], 'class', ['E']),
    R('A202', [290, 270, 352, 305], 'class', ['E']),
    R('A201', [290, 305, 352, 345], 'class', ['E']),
    R('A200', [290, 345, 352, 425], 'lab', ['E']),
    ST('W', [290, 425, 352, 455], 'E'),
    R('210', [290, 455, 352, 487], 'class', ['E']),
    R('209', [290, 487, 352, 520], 'class', ['E']),
    R('208', [290, 520, 352, 555], 'class', ['E']),
    R('207', [290, 555, 352, 592], 'class', ['E']),
    R('205', [290, 592, 352, 635], 'class', ['E']),
    R('203', [290, 635, 352, 680], 'class', ['E']),
    R('201', [290, 680, 352, 725], 'class', ['E']),
    R('', [290, 725, 352, 750], 'storage', ['E'], { name: 'Storage' }),
    // top row
    R('', [375, 208, 415, 268], 'lav', ['S'], { name: "Girls' Restroom" }),
    R('A205', [415, 208, 469, 268], 'class', ['S']),
    R('A206', [469, 208, 498, 268], 'class', ['S']),
    R('A208', [498, 208, 540, 268], 'class', ['S']),
    ST('N', [540, 208, 578, 268], 'S'),
    R('LAV', [578, 208, 605, 268], 'lav', ['S'], { name: "Boys' Restroom (LAV)" }),
    R('A210', [605, 208, 640, 268], 'class', ['S']),
    R('', [640, 208, 665, 268], 'storage', ['S'], { name: 'Storage' }),
    // inner row
    R('', [375, 292, 393, 345], 'storage', ['N'], { name: 'Storage' }),
    R('A204', [393, 292, 479, 345], 'lab', ['N']),
    R('A207', [479, 292, 565, 345], 'lab', ['N']),
    R('', [565, 292, 582, 345], 'storage', ['N'], { name: 'Storage' }),
    R('A209', [582, 292, 665, 345], 'lab', ['N']),
    // right column
    R('', [690, 208, 752, 227], 'storage', ['W'], { name: 'Storage' }),
    R('A211', [690, 227, 752, 262], 'class', ['W']),
    R('A212', [690, 262, 752, 298], 'class', ['W']),
    R('A213', [690, 298, 752, 330], 'class', ['W']),
    R('A214', [690, 330, 752, 360], 'class', ['W']),
    ST('E', [690, 360, 752, 395], 'W'),
    R('221', [690, 395, 752, 430], 'class', ['W']),
    R('222', [690, 430, 752, 475], 'class', ['W']),
    R('223', [690, 475, 752, 515], 'class', ['W']),
    R('224', [690, 515, 752, 552], 'class', ['W']),
    R('226', [690, 552, 752, 592], 'class', ['W']),
    R('228', [690, 592, 752, 632], 'class', ['W']),
    R('', [690, 632, 752, 690], 'office', ['W'], { name: 'Faculty Workroom' }),
    ST('SE', [690, 690, 752, 725], 'W'),
    R('', [690, 725, 752, 750], 'storage', ['W'], { name: 'Storage' }),
    // central block (south of the courtyard)
    R('211', [375, 402, 440, 460], 'class', ['W']),
    R('', [375, 460, 410, 524], 'lav', ['S'], { name: 'Restroom' }),
    R('', [410, 460, 440, 524], 'storage', ['S'], { name: 'Storage' }),
    R('212', [440, 402, 484, 524], 'class', ['S']),
    R('214', [484, 402, 528, 524], 'class', ['S']),
    R('216', [528, 402, 570, 524], 'class', ['S']),
    R('218', [570, 402, 609, 524], 'class', ['S']),
    R('219', [609, 402, 665, 460], 'class', ['E']),
    R('', [609, 460, 640, 524], 'lav', ['S'], { name: 'Restroom' }),
    R('', [640, 460, 665, 524], 'storage', ['E'], { name: 'Storage' }),
    // lower block
    R('', [375, 546, 431, 595], 'lav', ['W'], { name: 'Restroom' }),
    R('204', [375, 595, 431, 643], 'class', ['W']),
    R('202', [375, 643, 431, 700], 'class', ['W']),
    R('200', [375, 700, 431, 750], 'class', ['W']),
    R('213', [431, 546, 490, 630], 'class', ['N']),
    R('215', [490, 546, 550, 630], 'class', ['N']),
    R('217', [550, 546, 606, 630], 'class', ['N']),
    R('', [606, 546, 665, 603], 'lav', ['N'], { name: 'Restroom' }),
    R('225', [606, 603, 665, 643], 'class', ['E']),
    R('227', [606, 643, 665, 690], 'class', ['E']),
    R('229', [606, 690, 665, 750], 'class', ['E']),
  ],
];

// Level-1 footprint (second floor slab) = academic wing minus the courtyard and the notch
// over the Media Center.
export const LEVEL1_RECTS = BLOCKS[0].rects;

// Named hallway zones for the location readout.
export const ZONES = [
  { name: 'Main Hall', level: 0, r: [238, 750, 1000, 798] },
  { name: 'A-Wing Hallway', level: 0, r: [352, 208, 690, 292] },
  { name: 'A-Wing Hallway', level: 1, r: [352, 208, 690, 292] },
  { name: '100s Hallway', level: 0, r: [352, 292, 690, 750] },
  { name: '200s Hallway', level: 1, r: [352, 292, 690, 750] },
  { name: 'Theatre Hallway', level: 0, r: [217, 798, 543, 1183] },
  { name: 'Gym Hallway', level: 0, r: [1000, 600, 1380, 1110] },
  { name: 'Gym Connector', level: 0, r: [988, 826, 1027, 862] },
];

// Exterior doors. dir = outward normal. at = point on the exterior wall (plan units).
export const ENTRANCES = [
  { at: [238, MAIN_HALL_Y], dir: 'W', w: 5.2, main: true, name: 'Main Entrance' },
  { at: [217, 923], dir: 'W', w: 2.0, name: '300s Exit' },
  { at: [297, 1175], dir: 'S', w: 2.0, name: 'South Exit' },
  { at: [534, 1183], dir: 'S', w: 2.0, name: 'Theatre Hallway Exit' },
  { at: [661, 880], dir: 'W', w: 2.6, name: 'Dining Patio Doors' },
  { at: [363, 208], dir: 'N', w: 2.6, name: 'A-Wing West Exit' },
  { at: [677, 208], dir: 'N', w: 2.6, name: 'A-Wing East Exit' },
  { at: [375, 373], dir: 'E', w: 2.0, name: 'Courtyard Doors' },
  { at: [665, 373], dir: 'W', w: 2.0, name: 'Courtyard Doors' },
  { at: [1324, 600], dir: 'N', w: 2.0, name: '400s Exit' },
  { at: [1380, 1042], dir: 'E', w: 2.4, name: 'Gym Exit' },
  { at: [1027, 1042], dir: 'W', w: 2.4, name: 'Gym Exit' },
];

// ---- apply the Main Hall widening to every rectangle and point south of it
for (const b of BLOCKS) b.rects = b.rects.map(shiftRect);
for (const list of ROOMS) for (const rm of list) rm.r = shiftRect(rm.r);
for (const z of ZONES) z.r = shiftRect(z.r);
for (const e of ENTRANCES) if (e.name !== 'Main Entrance') e.at = shiftPt(e.at);
