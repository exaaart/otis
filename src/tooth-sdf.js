// Процедурная анатомическая модель верхнего первого моляра на основе SDF.
// Коронка: ромбовидный контур, естественное сужение к шейке (CEJ), 4 разноразмерных
// бугорка, косой гребень (crista obliqua), краевые гребни и V-образная система фиссур.
// Корни: ствол, чёткая трифуркация и 3 анатомических изогнутых корня.
// Пульпа: единая связная камера с 4 заострёнными рогами и 3 корневыми каналами.

/* ---------- Базовые функции ---------- */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);

function roundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  const qz = Math.abs(z) - bz + r;
  const mx = qx > 0 ? qx : 0;
  const my = qy > 0 ? qy : 0;
  const mz = qz > 0 ? qz : 0;
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
function ellipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx;
  const ay = y / ry;
  const az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx;
  const by = ay / ry;
  const bz = az / rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}
function capsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// Расстояние в плоскости XZ до отрезка (ax, az) — (bx, bz) для V-образных фиссур.
function seg2D(px, pz, ax, az, bx, bz) {
  const pax = px - ax;
  const paz = pz - az;
  const bax = bx - ax;
  const baz = bz - az;
  const h = clamp01((pax * bax + paz * baz) / (bax * bax + baz * baz));
  const dx = pax - bax * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dz * dz);
}

// Конус со скруглёнными концами (точное SDF, И. Кильез).
function makeRoundCone(a, b, r1, r2) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  return { ax: a[0], ay: a[1], az: a[2], bax, bay, baz, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2 };
}
function roundCone(c, px, py, pz) {
  const pax = px - c.ax;
  const pay = py - c.ay;
  const paz = pz - c.az;
  const y = pax * c.bax + pay * c.bay + paz * c.baz;
  const z = y - c.l2;
  const qx = pax * c.l2 - c.bax * y;
  const qy = pay * c.l2 - c.bay * y;
  const qz = paz * c.l2 - c.baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * c.l2;
  const z2 = z * z * c.l2;
  const k = Math.sign(c.rr) * c.rr * c.rr * x2;
  if (Math.sign(z) * c.a2 * z2 > k) return Math.sqrt(x2 + z2) * c.il2 - c.r2;
  if (Math.sign(y) * c.a2 * y2 < k) return Math.sqrt(x2 + y2) * c.il2 - c.r1;
  return (Math.sqrt(x2 * c.a2 * c.il2) + y * c.rr) * c.il2 - c.r1;
}

const bezier = (s, c, t, u) => {
  const v = 1 - u;
  return [
    v * v * s[0] + 2 * v * u * c[0] + u * u * t[0],
    v * v * s[1] + 2 * v * u * c[1] + u * u * t[1],
    v * v * s[2] + 2 * v * u * c[2] + u * u * t[2],
  ];
};

// Изогнутый сужающийся корень с предвычисленным AABB для быстрого отсечения.
function makeTube({ s, c, t, r0, r1, from = 0, to = 1, seg = 10, squashX = 1, power = 0.9 }) {
  const pts = [];
  const radii = [];
  let minX = 1e9;
  let minY = 1e9;
  let minZ = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  let maxZ = -1e9;
  const cx = (s[0] + t[0]) * 0.5;

  for (let i = 0; i <= seg; i++) {
    const u = from + ((to - from) * i) / seg;
    const p = bezier(s, c, t, u);
    const rad = r0 + (r1 - r0) * Math.pow(u, power);
    pts.push(p);
    radii.push(rad);
    const rx = rad * squashX;
    const px = cx + (p[0] - cx) * squashX;
    if (px - rx < minX) minX = px - rx;
    if (px + rx > maxX) maxX = px + rx;
    if (p[1] - rad < minY) minY = p[1] - rad;
    if (p[1] + rad > maxY) maxY = p[1] + rad;
    if (p[2] - rad < minZ) minZ = p[2] - rad;
    if (p[2] + rad > maxZ) maxZ = p[2] + rad;
  }

  const cones = [];
  for (let i = 0; i < seg; i++) cones.push(makeRoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1]));
  return { cones, squashX, invSquashX: 1 / squashX, cx, minX, minY, minZ, maxX, maxY, maxZ };
}

function makeChainTube(points, radii) {
  let minX = 1e9;
  let minY = 1e9;
  let minZ = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  let maxZ = -1e9;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rad = radii[i];
    if (p[0] - rad < minX) minX = p[0] - rad;
    if (p[0] + rad > maxX) maxX = p[0] + rad;
    if (p[1] - rad < minY) minY = p[1] - rad;
    if (p[1] + rad > maxY) maxY = p[1] + rad;
    if (p[2] - rad < minZ) minZ = p[2] - rad;
    if (p[2] + rad > maxZ) maxZ = p[2] + rad;
  }
  const cones = [];
  for (let i = 0; i < points.length - 1; i++) {
    cones.push(makeRoundCone(points[i], points[i + 1], radii[i], radii[i + 1]));
  }
  return { cones, squashX: 1, invSquashX: 1, cx: 0, minX, minY, minZ, maxX, maxY, maxZ };
}

function boxDist(minX, minY, minZ, maxX, maxY, maxZ, x, y, z) {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function tubeDist(tube, x, y, z, cutoff = 1e9) {
  const bd = boxDist(tube.minX, tube.minY, tube.minZ, tube.maxX, tube.maxY, tube.maxZ, x, y, z);
  if (bd > cutoff) return bd;
  const xx = tube.squashX === 1 ? x : tube.cx + (x - tube.cx) * tube.invSquashX;
  const cones = tube.cones;
  let d = 1e9;
  for (let i = 0; i < cones.length; i++) {
    const di = roundCone(cones[i], xx, y, z);
    if (di < d) d = di;
  }
  return d * tube.squashX;
}

/* ---------- Анатомия верхнего первого моляра ---------- */
// +X = мезиальная, -X = дистальная, +Z = щёчная (к зрителю), -Z = нёбная, +Y = жевательная.

// Волнистая линия цементно-эмалевой границы (шейка зуба / CEJ):
// выше на проксимальных (мезиальной/дистальной) сторонах, ниже на щёчной и нёбной.
export function cejY(x, z) {
  const theta = Math.atan2(z, x);
  return -0.36 + 0.075 * Math.cos(2 * theta) - 0.015 * Math.sin(theta);
}

// Корни: мезиально-щёчный (уплощён, дистальный изгиб), дистально-щёчный (короче),
// нёбный (самый длинный и массивный, дугообразный).
const ROOTS = [
  { s: [0.33, -0.64, 0.24], c: [0.55, -1.50, 0.36], t: [0.32, -2.50, 0.28], r0: 0.31, r1: 0.074, squashX: 0.78, power: 0.88 },
  { s: [-0.32, -0.64, 0.22], c: [-0.52, -1.42, 0.33], t: [-0.48, -2.30, 0.26], r0: 0.285, r1: 0.072, squashX: 0.82, power: 0.9 },
  { s: [0.02, -0.62, -0.28], c: [0.04, -1.54, -0.74], t: [0.02, -2.60, -0.60], r0: 0.34, r1: 0.078, squashX: 1.04, power: 0.86 },
];
const rootTubes = ROOTS.map((r) => makeTube(r));

// Корневые каналы пульпы: начинаются ВНУТРИ дна пульпарной камеры (единая связная сеть)
// и плавно следуют мировым осям корней, сужаясь к верхушкам.
const canalTubes = ROOTS.map((r) => {
  const cx = (r.s[0] + r.t[0]) * 0.5;
  const worldX = (x) => cx + (x - cx) * r.squashX;
  const pts = [];
  const rads = [];
  // Точка 0 — внутри дна пульпарной камеры (гарантированное слияние с камерой)
  pts.push([worldX(r.s[0]) * 0.38, -0.28, r.s[2] * 0.38]);
  rads.push(0.092);
  // Точка 1 — устье корневого канала
  pts.push([worldX(r.s[0]) * 0.82, -0.58, r.s[2] * 0.82]);
  rads.push(0.078);
  // 8 сегментов вдоль кривой Безье корня
  const seg = 8;
  for (let i = 1; i <= seg; i++) {
    const u = (0.85 * i) / seg;
    const p = bezier(r.s, r.c, r.t, u);
    pts.push([worldX(p[0]), p[1], p[2]]);
    rads.push(0.074 + (0.048 - 0.074) * Math.pow(i / seg, 0.85));
  }
  return makeChainTube(pts, rads);
});

// Ствол корня: анатомический перехват в области шейки (~18% уже экватора коронки, без «гриба»).
const trunk = makeRoundCone([0, -0.22, 0], [0, -0.84, 0], 0.72, 0.53);

// 4 анатомически разноразмерных бугорка: [x, y, z, rx, ry, rz]
// MP (мезио-нёбный — крупнейший), MB (мезио-щёчный — высокий), DB (дисто-щёчный), DP (дисто-нёбный — компактный).
const CUSPS = [
  [0.33, 0.39, -0.31, 0.39, 0.36, 0.37], // MP
  [0.40, 0.44, 0.33, 0.34, 0.34, 0.31],  // MB
  [-0.37, 0.42, 0.30, 0.32, 0.32, 0.30], // DB
  [-0.39, 0.36, -0.30, 0.29, 0.30, 0.28], // DP
];

// 4 конусовидных рога пульпы (плавно сужающиеся к бугоркам)
const pulpHorns = CUSPS.map((c) =>
  makeRoundCone([c[0] * 0.36, -0.15, c[2] * 0.36], [c[0] * 0.60, 0.09, c[2] * 0.60], 0.088, 0.046)
);

// Гладкая V-образная карта жевательных фиссур и ямок (без цилиндрических «колбасок»!).
// Возвращает интенсивность углубления в [0, 1] для скульптинга поверхности и окклюзии.
function occlusalValley(x, z) {
  // Расстояния до ветвей фиссур в плоскости XZ:
  // 1) Центральная борозда: мезиальная ямка -> центральная ямка
  const dCentralM = seg2D(x, z, 0.48, 0.02, 0.07, 0.03);
  // 2) Пересечение через косой гребень к дистальной ямке (чуть мягче — crista obliqua)
  const dObliqueCross = seg2D(x, z, 0.07, 0.03, -0.28, -0.12);
  // 3) Щёчная борозда: от центра к щёчному краю
  const dBuccal = seg2D(x, z, 0.06, 0.03, 0.01, 0.68);
  // 4) Дисто-нёбная борозда: от дистальной ямки к нёбному краю
  const dPalatal = seg2D(x, z, -0.28, -0.12, -0.14, -0.68);
  // 5) Мезиальные и дистальные дополнительные веточки
  const dMesV1 = seg2D(x, z, 0.44, 0.02, 0.56, 0.24);
  const dMesV2 = seg2D(x, z, 0.44, 0.02, 0.54, -0.22);
  const dDistV = seg2D(x, z, -0.28, -0.12, -0.48, 0.14);

  // V-профиль: exp(-sqrt(r^2 + eps) / w) — чёткая складка по дну и плавный выход на скаты бугров
  const vSharp = (r, w) => Math.exp(-Math.sqrt(r * r + 0.0025) / w);

  let val = 0;
  val = Math.max(val, vSharp(dCentralM, 0.115) * 0.95);
  val = Math.max(val, vSharp(dObliqueCross, 0.095) * 0.62); // косой гребень остаётся приподнятым!
  val = Math.max(val, vSharp(dBuccal, 0.105) * 0.90);
  val = Math.max(val, vSharp(dPalatal, 0.105) * 0.88);
  val = Math.max(val, vSharp(dMesV1, 0.085) * 0.52);
  val = Math.max(val, vSharp(dMesV2, 0.085) * 0.52);
  val = Math.max(val, vSharp(dDistV, 0.085) * 0.52);

  // Центральная и дистальная жевательные ямки
  const rCent = Math.hypot((x - 0.08) / 1.15, z - 0.03);
  const rDist = Math.hypot((x + 0.29) / 1.05, z + 0.13);
  const rMes = Math.hypot(x - 0.46, z - 0.02);
  const pits =
    Math.exp(-(rCent * rCent) / 0.048) * 0.85 +
    Math.exp(-(rDist * rDist) / 0.028) * 0.68 +
    Math.exp(-(rMes * rMes) / 0.020) * 0.50;

  return Math.min(1.15, Math.max(val, pits * 0.92));
}

function crownDist(x, y, z) {
  // Быстрое отсечение в нижней зоне корней
  if (y < -0.95) return -0.46 - y;

  // Ромбовидный асимметричный контур верхнего моляра
  const xs = x - 0.08 * z;

  // Гармоничная форма коронки: мягкая экваториальная выпуклость (~18% шире шейки, без нависания)
  let d = ellipsoid(xs, y - 0.05, z, 0.89, 0.53, 0.81);
  d = smin(d, roundBox(xs, y - 0.18, z, 0.77, 0.34, 0.69, 0.31), 0.16);

  // 4 анатомических бугорка
  for (let i = 0; i < CUSPS.length; i++) {
    const c = CUSPS[i];
    d = smin(d, ellipsoid(x - c[0], y - c[1], z - c[2], c[3], c[4], c[5]), 0.15);
  }

  // Косой гребень (crista obliqua: MP -> DB) и мезиальный/дистальный краевые гребни
  d = smin(d, capsule(x, y, z, 0.28, 0.44, -0.26, -0.29, 0.45, 0.24, 0.145), 0.13);
  d = smin(d, capsule(x, y, z, 0.61, 0.39, -0.24, 0.65, 0.41, 0.24, 0.13), 0.12);
  d = smin(d, capsule(x, y, z, -0.59, 0.36, -0.23, -0.61, 0.38, 0.22, 0.12), 0.12);

  // Деликатный пришеечный эмалевый валик чуть выше CEJ
  const cej = cejY(x, z);
  const cervicalBand = Math.exp(-Math.pow((y - (cej + 0.15)) / 0.13, 2));
  d -= 0.015 * cervicalBand;

  // V-образная скульптурная проработка жевательной поверхности (только сверху коронки)
  if (y > 0.18 && x > -0.82 && x < 0.85 && z > -0.82 && z < 0.82) {
    const topMask = smoothstep(0.24, 0.52, y);
    const val = occlusalValley(x, z);
    d += val * 0.165 * topMask;
  }

  // Мягкие вертикальные борозды на щёчной и нёбной стенках между бугорками
  if (y > -0.15 && y < 0.62) {
    const wallY = smoothstep(-0.10, 0.18, y) * (1 - smoothstep(0.45, 0.62, y));
    if (z > 0.35) {
      const bGroove = Math.exp(-Math.pow((x - 0.01) / 0.11, 2));
      d += 0.032 * bGroove * wallY * smoothstep(0.4, 0.72, z);
    }
    if (z < -0.35) {
      const pGroove = Math.exp(-Math.pow((x + 0.15) / 0.11, 2));
      d += 0.028 * pGroove * wallY * smoothstep(-0.4, -0.7, z);
    }
  }

  // Лёгкое сглаживание масштаба поля, чтобы градиент оставался близким к 1
  return d * 0.92;
}

export function toothSDF(x, y, z) {
  let d = crownDist(x, y, z);

  // Ствол корня и трифуркация
  if (y < 0.25) {
    let tr = roundCone(trunk, x, y, z * 1.12) * 0.89;
    // Мягкие межкорневые желобки, плавно переходящие в трифуркацию
    if (y < -0.42 && y > -1.25) {
      const fluteB = capsule(x, y, z, 0.0, -0.60, 0.60, 0.0, -1.06, 0.48, 0.095);
      const fluteM = capsule(x, y, z, 0.62, -0.60, -0.04, 0.52, -1.06, -0.10, 0.095);
      const fluteD = capsule(x, y, z, -0.62, -0.60, -0.04, -0.52, -1.06, -0.10, 0.095);
      tr = smax(tr, -Math.min(fluteB, Math.min(fluteM, fluteD)), 0.095);
    }
    d = smin(d, tr, 0.15);
  }

  // Три корня с AABB-отсечением
  if (y < 0.05) {
    const cutoff = d + 0.32;
    let roots = tubeDist(rootTubes[0], x, y, z, cutoff);
    const r1 = tubeDist(rootTubes[1], x, y, z, Math.min(cutoff, roots + 0.22));
    roots = smin(roots, r1, 0.095);
    const r2 = tubeDist(rootTubes[2], x, y, z, Math.min(cutoff, roots + 0.22));
    roots = smin(roots, r2, 0.095);

    d = smin(d, roots, 0.15);
  }

  return d;
}

export function pulpSDF(x, y, z) {
  const xs = x - 0.06 * z;
  // Пульпарная камера (ромбовидная, повторяет контур коронки)
  let d = ellipsoid(xs, y + 0.16, z, 0.34, 0.17, 0.29);
  // 4 изящных сужающихся рога пульпы под бугорками
  for (let i = 0; i < pulpHorns.length; i++) {
    d = smin(d, roundCone(pulpHorns[i], x, y, z), 0.10);
  }
  // Дно пульпарной камеры (единый переход к устьям всех 3 каналов)
  d = smin(d, ellipsoid(xs, y + 0.31, z, 0.26, 0.13, 0.22), 0.10);

  if (y < 0.05) {
    const cutoff = d + 0.26;
    for (let i = 0; i < canalTubes.length; i++) {
      d = smin(d, tubeDist(canalTubes[i], x, y, z, cutoff), 0.09);
    }
  }
  return d;
}

/* ---------- Surface Nets ---------- */

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function surfaceNets(sdf, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);

  // Заполняем поле блоками 4×4×4: вдали от поверхности блок заполняется одним
  // значением, рядом — считаем точно.
  const B = 4;
  const skip = 2.0 * ((B - 1) * cell * 0.8660254) + cell;
  for (let k0 = 0; k0 < nz; k0 += B)
    for (let j0 = 0; j0 < ny; j0 += B)
      for (let i0 = 0; i0 < nx; i0 += B) {
        const i1 = Math.min(i0 + B, nx);
        const j1 = Math.min(j0 + B, ny);
        const k1 = Math.min(k0 + B, nz);
        const dc = sdf(
          min[0] + (i0 + (i1 - i0 - 1) * 0.5) * cell,
          min[1] + (j0 + (j1 - j0 - 1) * 0.5) * cell,
          min[2] + (k0 + (k1 - k0 - 1) * 0.5) * cell
        );
        const far = Math.abs(dc) > skip;
        for (let k = k0; k < k1; k++) {
          const zk = min[2] + k * cell;
          for (let j = j0; j < j1; j++) {
            const yj = min[1] + j * cell;
            const row = nx * (j + ny * k);
            for (let i = i0; i < i1; i++) {
              F[i + row] = far ? dc : sdf(min[0] + i * cell, yj, zk);
            }
          }
        }
      }

  // Одна вершина на каждую ячейку, через которую проходит поверхность.
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellIndex = new Int32Array(cx * cy * cz).fill(-1);
  const cid = (i, j, k) => i + cx * (j + cy * k);
  const pos = [];
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c];
          v[c] = F[id(i + o[0], j + o[1], k + o[2])];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let eIdx = 0; eIdx < 12; eIdx++) {
          const a = EDGES[eIdx][0];
          const b = EDGES[eIdx][1];
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          const oa = CORNERS[a];
          const ob = CORNERS[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          n++;
        }
        cellIndex[cid(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
      }

  // Четырёхугольник вокруг каждого ребра сетки со сменой знака.
  const tri = [];
  const P = pos;
  const d2 = (a, b) => {
    const dx = P[a * 3] - P[b * 3];
    const dy = P[a * 3 + 1] - P[b * 3 + 1];
    const dz = P[a * 3 + 2] - P[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  function quad(a, b, c, d, keep) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!keep) {
      const tmp = b;
      b = d;
      d = tmp;
    }
    if (d2(a, c) < d2(b, d)) tri.push(a, b, c, a, c, d);
    else tri.push(a, b, d, b, c, d);
  }
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const in0 = F[id(i, j, k)] < 0;
        if (i < cx && j > 0 && j < cy && k > 0 && k < cz && F[id(i + 1, j, k)] < 0 !== in0)
          quad(cellIndex[cid(i, j - 1, k - 1)], cellIndex[cid(i, j, k - 1)], cellIndex[cid(i, j, k)], cellIndex[cid(i, j - 1, k)], in0);
        if (j < cy && i > 0 && i < cx && k > 0 && k < cz && F[id(i, j + 1, k)] < 0 !== in0)
          quad(cellIndex[cid(i - 1, j, k - 1)], cellIndex[cid(i - 1, j, k)], cellIndex[cid(i, j, k)], cellIndex[cid(i, j, k - 1)], in0);
        if (k < cz && i > 0 && i < cx && j > 0 && j < cy && F[id(i, j, k + 1)] < 0 !== in0)
          quad(cellIndex[cid(i - 1, j - 1, k)], cellIndex[cid(i, j - 1, k)], cellIndex[cid(i, j, k)], cellIndex[cid(i - 1, j, k)], in0);
      }

  // Проецируем вершины на нулевую изоповерхность и считаем градиентные нормали
  // методом тетраэдра (4 вызова SDF вместо 6 — почти вдвое быстрее при той же точности).
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const eProj = cell * 0.25;
  const eNorm = Math.min(0.0085, cell * 0.22);
  for (let q = 0; q < count; q++) {
    let x = positions[q * 3];
    let y = positions[q * 3 + 1];
    let z = positions[q * 3 + 2];

    // Шаг 1: проекция на изоповерхность по тетраэдрическому градиенту
    let d0 = sdf(x, y, z);
    if (d0 > cell) d0 = cell;
    else if (d0 < -cell) d0 = -cell;
    let f1 = sdf(x + eProj, y - eProj, z - eProj);
    let f2 = sdf(x - eProj, y - eProj, z + eProj);
    let f3 = sdf(x - eProj, y + eProj, z - eProj);
    let f4 = sdf(x + eProj, y + eProj, z + eProj);
    let gx = f1 - f2 - f3 + f4;
    let gy = -f1 - f2 + f3 + f4;
    let gz = -f1 + f2 - f3 + f4;
    let gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    x -= (gx / gl) * d0;
    y -= (gy / gl) * d0;
    z -= (gz / gl) * d0;

    // Шаг 2: уточнённая аналитическая нормаль в спроецированной точке
    f1 = sdf(x + eNorm, y - eNorm, z - eNorm);
    f2 = sdf(x - eNorm, y - eNorm, z + eNorm);
    f3 = sdf(x - eNorm, y + eNorm, z - eNorm);
    f4 = sdf(x + eNorm, y + eNorm, z + eNorm);
    gx = f1 - f2 - f3 + f4;
    gy = -f1 - f2 + f3 + f4;
    gz = -f1 + f2 - f3 + f4;
    gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;

    positions[q * 3] = x;
    positions[q * 3 + 1] = y;
    positions[q * 3 + 2] = z;
    normals[q * 3] = gx / gl;
    normals[q * 3 + 1] = gy / gl;
    normals[q * 3 + 2] = gz / gl;
  }

  // Компактный Uint16Array вдвое экономит память и пропускную способность GPU
  const index = count < 65536 ? new Uint16Array(tri) : new Uint32Array(tri);
  // Потреугольный контроль ориентации: гарантирует наружный обход вершин
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a];
    const wy = positions[c + 1] - positions[a + 1];
    const wz = positions[c + 2] - positions[a + 2];
    const fx = uy * wz - uz * wy;
    const fy = uz * wx - ux * wz;
    const fz = ux * wy - uy * wx;
    const nxSum = normals[a] + normals[b] + normals[c];
    const nySum = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nzSum = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (fx * nxSum + fy * nySum + fz * nzSum < 0) {
      const tmp = index[t + 1];
      index[t + 1] = index[t + 2];
      index[t + 2] = tmp;
    }
  }
  return { position: positions, normal: normals, index };
}

/* ---------- Биологическая окраска и маски материалов ---------- */
// mask.x = доля эмали (1 = коронка, 0 = цемент корня)
// mask.y = окклюзия углублений (V-фиссуры и зона трифуркации)
// mask.z = полупрозрачность вершин бугорков (опалесценция)

function paint(position, normal) {
  const n = position.length / 3;
  const color = new Float32Array(n * 3);
  const mask = new Float32Array(n * 3);

  // Реалистичная палитра здорового зуба (Vita A1 — естественная тёплая слоновая кость)
  const enamelCervical = [0.928, 0.884, 0.798]; // тёплый пришеечный слой эмали над дентином
  const enamelBody = [0.955, 0.942, 0.908];     // чистая натуральная эмаль коронки (без пересвета)
  const enamelTip = [0.895, 0.935, 0.958];      // полупрозрачная опалесценция вершин бугорков
  const fissureCol = [0.735, 0.684, 0.592];     // естественная тень и пигментация в глубине фиссур
  const cement = [0.878, 0.812, 0.685];         // тёплый матовый цемент корня
  const apex = [0.790, 0.712, 0.578];           // более тёплые верхушки корней
  const furcationCol = [0.740, 0.668, 0.542];   // мягкая окклюзия в своде трифуркации

  for (let i = 0; i < n; i++) {
    const x = position[i * 3];
    const y = position[i * 3 + 1];
    const z = position[i * 3 + 2];
    const ny = normal[i * 3 + 1];

    const cej = cejY(x, z);
    const tEnamel = smoothstep(cej - 0.04, cej + 0.04, y);
    const tCervGrad = smoothstep(cej, cej + 0.44, y);
    const tTip = smoothstep(0.46, 0.74, y) * smoothstep(0.15, 0.75, ny);
    const tApex = smoothstep(-0.72, -2.52, y);

    // Точно совпадает с геометрией V-фиссур на жевательной поверхности!
    let tFiss = 0;
    if (y > 0.25) {
      const val = occlusalValley(x, z);
      // Фокусируем затемнение строго в глубине бороздок и ямок (степень 1.65)
      tFiss = Math.pow(clamp01(val), 1.65) * smoothstep(0.32, 0.52, y) * smoothstep(0.25, 0.85, ny);
    }

    // Окклюзия свода трифуркации
    const radial = Math.sqrt(x * x + z * z);
    const tFurc = (1 - smoothstep(0.05, 0.44, radial)) * smoothstep(-0.55, -0.95, y) * (1 - smoothstep(-1.45, -2.05, y));

    const ao = Math.min(1, tFiss * 0.95 + tFurc * 0.72);
    mask[i * 3] = tEnamel;
    mask[i * 3 + 1] = ao;
    mask[i * 3 + 2] = tTip * tEnamel;

    for (let ch = 0; ch < 3; ch++) {
      let en = enamelCervical[ch] + (enamelBody[ch] - enamelCervical[ch]) * tCervGrad;
      en = en + (enamelTip[ch] - en) * tTip * 0.72;
      en = en + (fissureCol[ch] - en) * tFiss * 0.86;

      let rt = cement[ch] + (apex[ch] - cement[ch]) * tApex;
      rt = rt + (furcationCol[ch] - rt) * tFurc * 0.65;

      // sRGB -> linear для vertexColors Three.js
      color[i * 3 + ch] = Math.pow(rt + (en - rt) * tEnamel, 2.2);
    }
  }
  return { color, mask };
}

/* ---------- Публичная функция ---------- */

export function buildToothPart({ quality = 'high' } = {}) {
  const cell = quality === 'low' ? 0.052 : 0.044;
  const tooth = surfaceNets(toothSDF, [-1.15, -2.75, -1.05], [1.15, 0.92, 1.02], cell);
  const painted = paint(tooth.position, tooth.normal);
  tooth.color = painted.color;
  tooth.mask = painted.mask;
  return tooth;
}

export function buildPulpPart({ quality = 'high' } = {}) {
  const pulpCell = quality === 'low' ? 0.040 : 0.040;
  return surfaceNets(pulpSDF, [-0.72, -2.55, -0.92], [0.72, 0.18, 0.52], pulpCell);
}

export function buildToothData({ quality = 'high' } = {}) {
  return {
    tooth: buildToothPart({ quality }),
    pulp: buildPulpPart({ quality }),
  };
}
