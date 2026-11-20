import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToothData, buildToothPart, buildPulpPart, toothSDF, pulpSDF, cejY } from './tooth-sdf.js';

function inspectMesh(part) {
  const { position: P, normal: N, index: I } = part;
  const verts = P.length / 3;
  const tris = I.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let badNorm = 0;
  let nanCount = 0;

  for (let i = 0; i < verts; i++) {
    for (let k = 0; k < 3; k++) {
      const p = P[i * 3 + k];
      const n = N[i * 3 + k];
      if (!Number.isFinite(p) || !Number.isFinite(n)) nanCount++;
      if (p < min[k]) min[k] = p;
      if (p > max[k]) max[k] = p;
    }
    const nl = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    if (Math.abs(nl - 1) > 0.015) badNorm++;
  }

  let degen = 0;
  let flipped = 0;
  const edgeCount = new Map();
  const addEdge = (u, v) => {
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  };

  for (let t = 0; t < tris; t++) {
    const ia = I[t * 3];
    const ib = I[t * 3 + 1];
    const ic = I[t * 3 + 2];
    addEdge(ia, ib);
    addEdge(ib, ic);
    addEdge(ic, ia);

    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a];
    const wy = P[c + 1] - P[a + 1];
    const wz = P[c + 2] - P[a + 2];
    const fx = uy * wz - uz * wy;
    const fy = uz * wx - ux * wz;
    const fz = ux * wy - uy * wx;
    if (Math.hypot(fx, fy, fz) < 1e-7) degen++;
    const nx = N[a] + N[b] + N[c];
    const ny = N[a + 1] + N[b + 1] + N[c + 1];
    const nz = N[a + 2] + N[b + 2] + N[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) flipped++;
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const c of edgeCount.values()) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
  }

  // Count connected components via union-find
  const parent = new Int32Array(verts);
  for (let i = 0; i < verts; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < tris; t++) {
    union(I[t * 3], I[t * 3 + 1]);
    union(I[t * 3 + 1], I[t * 3 + 2]);
  }
  const roots = new Set();
  for (let i = 0; i < verts; i++) roots.add(find(i));

  return {
    verts,
    tris,
    min,
    max,
    badNorm,
    nanCount,
    degen,
    flipped,
    boundaryEdges,
    nonManifoldEdges,
    components: roots.size,
  };
}

test('high-quality procedural molar meets topology, budget, and speed targets', () => {
  const t0 = performance.now();
  const tooth = buildToothPart({ quality: 'high' });
  const toothMs = performance.now() - t0;
  const t1 = performance.now();
  const pulp = buildPulpPart({ quality: 'high' });
  const pulpMs = performance.now() - t1;
  const buildMs = toothMs + pulpMs;

  const toothStats = inspectMesh(tooth);
  const pulpStats = inspectMesh(pulp);
  const totalTris = toothStats.tris + pulpStats.tris;

  console.log('HIGH:', { toothMs: Math.round(toothMs), pulpMs: Math.round(pulpMs), buildMs: Math.round(buildMs), toothStats, pulpStats, totalTris });

  assert.ok(toothMs < 450, `Expected startup tooth build < 450ms, got ${toothMs.toFixed(1)}ms`);
  assert.ok(buildMs < 650, `Expected full build < 650ms, got ${buildMs.toFixed(1)}ms`);
  assert.ok(totalTris <= 29000, `Expected total tris <= 29000, got ${totalTris}`);
  assert.ok(toothStats.tris >= 18000, `Expected detailed tooth mesh >= 18000 tris, got ${toothStats.tris}`);
  assert.ok(tooth.index instanceof Uint16Array, 'Expected compact Uint16Array index buffer for tooth');
  assert.ok(pulp.index instanceof Uint16Array, 'Expected compact Uint16Array index buffer for pulp');

  // Watertight, manifold, outward winding, and single connected piece on BOTH tooth and pulp
  for (const [label, s] of [
    ['tooth', toothStats],
    ['pulp', pulpStats],
  ]) {
    assert.equal(s.nanCount, 0, `${label}: NaN values found`);
    assert.equal(s.badNorm, 0, `${label}: non-unit normals found`);
    assert.equal(s.degen, 0, `${label}: degenerate triangles found`);
    assert.equal(s.flipped, 0, `${label}: flipped triangles found`);
    assert.equal(s.boundaryEdges, 0, `${label}: open boundary edges found`);
    assert.equal(s.nonManifoldEdges, 0, `${label}: non-manifold edges found`);
    assert.equal(s.components, 1, `${label}: expected 1 connected mesh, got ${s.components}`);
  }

  // Color & material mask attributes match vertex count
  assert.equal(tooth.color.length, toothStats.verts * 3);
  assert.equal(tooth.mask.length, toothStats.verts * 3);
  for (let i = 0; i < tooth.mask.length; i++) {
    assert.ok(tooth.mask[i] >= 0 && tooth.mask[i] <= 1, 'mask values must be in [0, 1]');
  }
});

test('low-quality procedural molar stays lightweight and manifold', () => {
  const t0 = performance.now();
  const data = buildToothData({ quality: 'low' });
  const buildMs = performance.now() - t0;
  const toothStats = inspectMesh(data.tooth);
  const pulpStats = inspectMesh(data.pulp);
  const totalTris = toothStats.tris + pulpStats.tris;

  console.log('LOW:', { buildMs: Math.round(buildMs), totalTris, toothTris: toothStats.tris, pulpTris: pulpStats.tris });

  assert.ok(totalTris <= 22500, `Expected low total tris <= 22500, got ${totalTris}`);
  assert.ok(data.tooth.index instanceof Uint16Array, 'Expected compact Uint16Array on low tier');
  assert.equal(toothStats.boundaryEdges, 0);
  assert.equal(toothStats.nonManifoldEdges, 0);
  assert.equal(toothStats.components, 1);
  assert.equal(pulpStats.boundaryEdges, 0);
  assert.equal(pulpStats.nonManifoldEdges, 0);
  assert.equal(pulpStats.components, 1);
});

test('anatomical proportions: cervical constriction, CEJ scallop, and pulp containment', () => {
  // CEJ must curve occlusally on proximal sides (z=0) vs apically on buccal/palatal (x=0)
  assert.ok(cejY(1, 0) > cejY(0, 1), 'CEJ should sit higher proximally than buccally');
  assert.ok(cejY(-1, 0) > cejY(0, -1), 'CEJ should sit higher proximally than palatally');

  // Crown equator (y=0.05) must be wider than cervical neck (y=-0.48)
  let eqMaxX = 0;
  let neckMaxX = 0;
  for (let x = 0; x < 1.2; x += 0.01) {
    if (toothSDF(x, 0.05, 0) < 0) eqMaxX = x;
    if (toothSDF(x, -0.48, 0) < 0) neckMaxX = x;
  }
  assert.ok(eqMaxX > neckMaxX + 0.14, `Expected cervical constriction: equator ${eqMaxX.toFixed(2)} vs neck ${neckMaxX.toFixed(2)}`);

  // Pulp must stay strictly inside outer tooth shell
  const { pulp } = buildToothData({ quality: 'low' });
  let outsideCount = 0;
  for (let i = 0; i < pulp.position.length; i += 3) {
    const d = toothSDF(pulp.position[i], pulp.position[i + 1], pulp.position[i + 2]);
    if (d >= 0) outsideCount++;
  }
  assert.equal(outsideCount, 0, `Pulp vertices protruded outside tooth surface: ${outsideCount}`);
});
