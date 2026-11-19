// Процедурная модель моляра на основе поля расстояний (SDF).
// Коронка, шейка и корни описаны простыми формами и соединены «мягким»
// объединением (smooth union), поэтому получается одна непрерывная гладкая
// поверхность без швов и острых стыков. Сетка строится методом Surface Nets,
// вершины проецируются точно на поверхность, а нормали берутся из градиента
// поля — так грани не видны даже при приближении.

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

function sphere(x, y, z, r) {
  return Math.sqrt(x * x + y * y + z * z) - r;
}
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
  return [0, 1, 2].map((i) => v * v * s[i] + 2 * v * u * c[i] + u * u * t[i]);
};

// Изогнутый сужающийся «корень» из цепочки скруглённых конусов.
function makeTube({ s, c, t, r0, r1, from = 0, to = 1, seg = 14, squashX = 1, power = 0.9 }) {
  const pts = [];
  const radii = [];
  for (let i = 0; i <= seg; i++) {
    const u = from + ((to - from) * i) / seg;
    pts.push(bezier(s, c, t, u));
    radii.push(r0 + (r1 - r0) * Math.pow(u, power));
  }
  const cones = [];
  for (let i = 0; i < seg; i++) cones.push(makeRoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1]));
  const cx = (s[0] + t[0]) / 2;
  return { cones, squashX, cx };
}
function tubeDist(tube, x, y, z) {
  const xx = tube.cx + (x - tube.cx) / tube.squashX;
  let d = 1e9;
  for (const c of tube.cones) {
    // Соседние конусы делят общую сферу на стыке, поэтому обычный min
    // даёт гладкую трубку без «колец».
    const di = roundCone(c, xx, y, z);
    if (di < d) d = di;
  }
  return d * tube.squashX;
}

/* ---------- Анатомия ---------- */

// Корни: два щёчных и один нёбный (как у верхнего моляра).
const ROOTS = [
  { s: [0.34, -0.6, 0.22], c: [0.54, -1.55, 0.3], t: [0.42, -2.55, 0.26], r0: 0.33, r1: 0.075, squashX: 0.8 },
  { s: [-0.34, -0.6, 0.22], c: [-0.56, -1.45, 0.32], t: [-0.45, -2.38, 0.3], r0: 0.31, r1: 0.075, squashX: 0.8 },
  { s: [0.0, -0.6, -0.3], c: [0.05, -1.45, -0.68], t: [0.07, -2.5, -0.72], r0: 0.36, r1: 0.085, squashX: 0.95 },
];
const rootTubes = ROOTS.map((r) => makeTube(r));
const canalTubes = ROOTS.map((r) =>
  makeTube({ ...r, s: [r.s[0] * 0.6, -0.5, r.s[2] * 0.6], r0: 0.085, r1: 0.04, from: 0.05, to: 0.95, power: 1, squashX: 1 })
);
const trunk = makeRoundCone([0, -0.12, 0], [0, -0.75, 0], 0.72, 0.52);

const CUSPS = [
  [0.43, 0.37, 0.35, 0.36],
  [-0.43, 0.38, 0.35, 0.34],
  [0.43, 0.36, -0.36, 0.34],
  [-0.43, 0.37, -0.36, 0.35],
];

function grooveDist(x, y, z) {
  return Math.min(
    capsule(x, y, z, -0.6, 0.6, 0, 0.6, 0.6, 0, 0.055),
    capsule(x, y, z, 0, 0.6, -0.52, 0, 0.6, 0.52, 0.055)
  );
}

function crownDist(x, y, z) {
  let d = roundBox(x, y - 0.02, z, 0.98, 0.38, 0.86, 0.46);
  d = smin(d, ellipsoid(x, y - 0.0, z, 1.02, 0.5, 0.9), 0.2);
  for (const c of CUSPS) d = smin(d, sphere(x - c[0], y - c[1], z - c[2], c[3]), 0.2);
  d = smax(d, -sphere(x, y - 0.78, z, 0.3), 0.14); // центральная ямка
  d = smax(d, -grooveDist(x, y, z), 0.08); // бороздки
  return d;
}

export function toothSDF(x, y, z) {
  let d = smin(crownDist(x, y, z), roundCone(trunk, x, y, z / 0.86) * 0.86, 0.3);
  let roots = tubeDist(rootTubes[0], x, y, z);
  roots = smin(roots, tubeDist(rootTubes[1], x, y, z), 0.12);
  roots = smin(roots, tubeDist(rootTubes[2], x, y, z), 0.12);
  return smin(d, roots, 0.26);
}

export function pulpSDF(x, y, z) {
  let d = ellipsoid(x, y + 0.2, z, 0.38, 0.19, 0.32); // пульпарная камера
  for (const c of CUSPS) d = smin(d, capsule(x, y, z, c[0] * 0.5, -0.16, c[2] * 0.5, c[0] * 0.66, -0.02, c[2] * 0.66, 0.06), 0.14); // рога пульпы
  d = smin(d, capsule(x, y, z, 0, -0.25, 0, 0, -0.6, 0, 0.16), 0.12);
  for (const t of canalTubes) d = smin(d, tubeDist(t, x, y, z), 0.1);
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

  // Заполняем поле блоками: вдали от поверхности блок заполняется одним
  // значением (знак гарантированно верный), рядом — считаем точно.
  const B = 4;
  const skip = 2.0 * ((B - 1) * cell * 0.8660254) + cell;
  for (let k0 = 0; k0 < nz; k0 += B)
    for (let j0 = 0; j0 < ny; j0 += B)
      for (let i0 = 0; i0 < nx; i0 += B) {
        const i1 = Math.min(i0 + B, nx);
        const j1 = Math.min(j0 + B, ny);
        const k1 = Math.min(k0 + B, nz);
        const dc = sdf(
          min[0] + (i0 + (i1 - i0 - 1) / 2) * cell,
          min[1] + (j0 + (j1 - j0 - 1) / 2) * cell,
          min[2] + (k0 + (k1 - k0 - 1) / 2) * cell
        );
        const far = Math.abs(dc) > skip;
        for (let k = k0; k < k1; k++)
          for (let j = j0; j < j1; j++)
            for (let i = i0; i < i1; i++)
              F[id(i, j, k)] = far ? dc : sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
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
        for (const [a, b] of EDGES) {
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
    if (!keep) [b, d] = [d, b];
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

  // Проецируем вершины точно на поверхность и берём нормали из градиента поля.
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const e = cell * 0.3;
  for (let q = 0; q < count; q++) {
    let x = positions[q * 3];
    let y = positions[q * 3 + 1];
    let z = positions[q * 3 + 2];
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let it = 0; it < 3; it++) {
      gx = sdf(x + e, y, z) - sdf(x - e, y, z);
      gy = sdf(x, y + e, z) - sdf(x, y - e, z);
      gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      if (it === 2) break;
      let d = sdf(x, y, z);
      if (d > cell) d = cell;
      else if (d < -cell) d = -cell;
      x -= gx * d;
      y -= gy * d;
      z -= gz * d;
    }
    positions.set([x, y, z], q * 3);
    normals.set([gx, gy, gz], q * 3);
  }

  const index = new Uint32Array(tri);
  // Контроль ориентации: нормаль первого треугольника должна смотреть наружу.
  if (index.length >= 3) {
    const [a, b, c] = [index[0] * 3, index[1] * 3, index[2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a];
    const wy = positions[c + 1] - positions[a + 1];
    const wz = positions[c + 2] - positions[a + 2];
    const fx = uy * wz - uz * wy;
    const fy = uz * wx - ux * wz;
    const fz = ux * wy - uy * wx;
    if (fx * normals[a] + fy * normals[a + 1] + fz * normals[a + 2] < 0) {
      for (let t = 0; t < index.length; t += 3) {
        const tmp = index[t + 1];
        index[t + 1] = index[t + 2];
        index[t + 2] = tmp;
      }
    }
  }
  return { position: positions, normal: normals, index };
}

/* ---------- Цвет: эмаль, шейка, корень ---------- */

function paint(position) {
  const n = position.length / 3;
  const color = new Float32Array(n * 3);
  const enamel = [0.965, 0.962, 0.94];
  const enamelTip = [0.93, 0.955, 0.965]; // полупрозрачный голубоватый край бугров
  const cement = [0.91, 0.86, 0.76];
  const apex = [0.86, 0.8, 0.69];
  const fissure = [0.88, 0.86, 0.8];
  for (let i = 0; i < n; i++) {
    const x = position[i * 3];
    const y = position[i * 3 + 1];
    const z = position[i * 3 + 2];
    // Граница эмали и корня (шейка) слегка волнистая, как у настоящего зуба.
    const theta = Math.atan2(z, x);
    const cej = -0.4 + 0.07 * Math.cos(2 * theta);
    const tEnamel = smoothstep(cej - 0.07, cej + 0.07, y);
    const tTip = smoothstep(0.5, 0.74, y) * 0.7;
    const tApex = smoothstep(-0.8, -2.5, y);
    const tFiss = (1 - smoothstep(0.0, 0.12, Math.min(grooveDist(x, y, z), sphere(x, y - 0.8, z, 0.3)))) * smoothstep(0.4, 0.55, y);
    for (let ch = 0; ch < 3; ch++) {
      let en = enamel[ch] + (enamelTip[ch] - enamel[ch]) * tTip;
      en = en + (fissure[ch] - en) * tFiss * 0.7;
      const rt = cement[ch] + (apex[ch] - cement[ch]) * tApex;
      // Цвета заданы в sRGB, а вершинные цвета Three.js — в линейном пространстве.
      color[i * 3 + ch] = Math.pow(rt + (en - rt) * tEnamel, 2.2);
    }
  }
  return color;
}

/* ---------- Публичная функция ---------- */

export function buildToothData({ quality = 'high' } = {}) {
  const cell = quality === 'low' ? 0.034 : 0.025;
  const tooth = surfaceNets(toothSDF, [-1.25, -2.8, -1.1], [1.25, 0.92, 1.05], cell);
  tooth.color = paint(tooth.position);
  const pulp = surfaceNets(pulpSDF, [-0.75, -2.6, -0.95], [0.75, 0.15, 0.55], cell * 0.8);
  return { tooth, pulp };
}
