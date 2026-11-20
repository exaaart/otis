// Интерактивная 3D-модель зуба для hero-блока.
// 1. Пытается загрузить /models/dental-tooth.glb (файл из /public/models/).
// 2. Если файла нет — строит анатомическую процедурную модель моляра (SDF).
// Энергоэффективный рендер: по требованию (0% GPU в покое), 2D-шум из текстуры
// вместо тяжёлого 3D-шума в шейдере, ленивая сборка пульпы только при открытии «Внутри».

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const MODEL_URL = '/models/dental-tooth.glb';

// h — высота от низа модели (0) до верха (1); angle — градусы вокруг оси Y (0 = к зрителю).
export const HOTSPOTS = [
  {
    id: 'surface',
    label: 'Жевательная поверхность',
    text: 'Бугорки и бороздки помогают измельчать пищу. В бороздках чаще всего задерживается налёт, поэтому их особенно важно хорошо чистить.',
    probe: { type: 'top', x: 0.14, z: 0.14 },
  },
  {
    id: 'enamel',
    label: 'Эмаль',
    text: 'Самая твёрдая ткань организма и защитный слой коронки. Эмаль не восстанавливается сама, поэтому её берегут: регулярная гигиена и осмотры.',
    probe: { type: 'side', h: 0.84, angle: -28 },
  },
  {
    id: 'neck',
    label: 'Шейка зуба',
    text: 'Место, где коронка переходит в корень. Обычно её закрывает десна. Если десна воспалена, шейка может стать чувствительной.',
    probe: { type: 'side', h: 0.66, angle: 34 },
  },
  {
    id: 'roots',
    label: 'Корни',
    text: 'Удерживают зуб в челюсти. Их не видно при обычном осмотре — состояние корней врач оценивает по снимку.',
    probe: { type: 'side', h: 0.32, angle: 16 },
  },
];

const XRAY_TEXT = {
  label: 'Внутри зуба',
  text: 'В центре зуба находится пульпа — нерв и сосуды. Она проходит по каналам внутри корней. Когда воспаление доходит до пульпы, врач лечит каналы.',
};

const VIEWS = {
  overview: { theta: 0.52, phi: 1.28, radius: 9.0 },
  top: { theta: 0.18, phi: 0.38, radius: 7.4 },
  roots: { theta: 2.55, phi: 1.94, radius: 8.5 },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function detectSoftwareWebGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function detectDeviceTier(isSoftwareGl) {
  const narrow = window.matchMedia('(max-width: 768px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const saveData = Boolean(navigator.connection?.saveData);
  const lowCores = (navigator.hardwareConcurrency || 8) <= 4;
  const lowMem = (navigator.deviceMemory || 8) <= 4;
  const isMobile = narrow || coarse || saveData;
  const isLowPower = isSoftwareGl || isMobile || lowCores || lowMem;
  return {
    isMobile,
    isLowPower,
    quality: isLowPower ? 'low' : 'high',
    tier: isSoftwareGl ? 'software' : isMobile ? 'mobile' : isLowPower ? 'eco' : 'desktop',
  };
}

/* ---------- Процедурная модель моляра (ленивая сборка по частям) ---------- */

function computeToothPart(quality, part) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (data) => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    const fallback = async () => {
      const mod = await import('./tooth-sdf.js');
      if (part === 'tooth') finish({ tooth: mod.buildToothPart({ quality }) });
      else if (part === 'pulp') finish({ pulp: mod.buildPulpPart({ quality }) });
      else finish(mod.buildToothData({ quality }));
    };
    try {
      const worker = new Worker(new URL('./tooth-sdf.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        worker.terminate();
        finish(e.data);
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        worker.terminate();
        fallback();
      };
      worker.postMessage({ quality, part });
    } catch {
      fallback();
    }
  });
}

function toGeometry({ position, normal, color, mask, index }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (mask) g.setAttribute('aMask', new THREE.BufferAttribute(mask, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

async function buildProceduralTooth(materials, quality) {
  // На старте строим только внешнюю поверхность зуба — пульпа собирается по требованию
  // при нажатии «Внутри», что почти вдвое ускоряет загрузку и экономит память GPU.
  const { tooth: toothData } = await computeToothPart(quality, 'tooth');

  const group = new THREE.Group();
  group.name = 'procedural-tooth';

  const tooth = new THREE.Mesh(toGeometry(toothData), materials.enamel);
  tooth.name = 'tooth';
  tooth.renderOrder = 2;
  group.add(tooth);

  const pulp = new THREE.Group();
  pulp.name = 'pulp';
  pulp.userData.lazyProcedural = true;
  pulp.userData.quality = quality;
  group.add(pulp);

  return group;
}

/* ---------- Компактная бесшовная текстура микрошума (64 КБ VRAM) ---------- */
// Заменяет 7 дорогих вызовов 3D-шума в фрагментном шейдере на 2 быстрые аппаратные выборки.

function createMicroNoiseTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);

  const hash2 = (x, y, seed) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };

  const tileNoise = (u, v, period, seed) => {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const ix0 = ((x0 % period) + period) % period;
    const iy0 = ((y0 % period) + period) % period;
    const ix1 = (ix0 + 1) % period;
    const iy1 = (iy0 + 1) % period;
    const a = hash2(ix0, iy0, seed);
    const b = hash2(ix1, iy0, seed);
    const c = hash2(ix0, iy1, seed);
    const d = hash2(ix1, iy1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // R: плавная органическая волна (CEJ + макро-зерно цемента)
      const nMed = tileNoise(u, v, 8, 11) * 0.65 + tileNoise(u, v, 16, 23) * 0.35;
      // G: мелкая микрофактура цемента и эмали
      const nFine = tileNoise(u, v, 24, 37) * 0.55 + tileNoise(u, v, 48, 59) * 0.45;
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(nMed * 255);
      data[idx + 1] = Math.round(nFine * 255);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ---------- Фотореалистичные энергоэффективные материалы ---------- */

function createMaterials() {
  const microNoiseTex = createMicroNoiseTexture();

  // Комбинированный PBR-материал зуба:
  // • Эмаль коронки: высокий IOR 1.62, влажный clearcoat, деликатные перикиматы, тёплая опалесценция.
  // • Цемент корня: полностью матовый (clearcoat = 0, roughness ~0.70), тёплая микрозернистость.
  // • Без лишнего sheen-слоя и без 3D-шума в пикселе: вся фактура читается из 64 КБ DataTexture.
  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 0.88,
    clearcoatRoughness: 0.11,
    ior: 1.62,
    specularIntensity: 0.85,
    specularColor: new THREE.Color(0xfffaf3),
  });

  enamel.onBeforeCompile = (shader) => {
    shader.uniforms.uMicroNoise = { value: microNoiseTex };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute vec3 aMask;
        varying vec3 vToothMask;
        varying vec3 vToothPos;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vToothMask = aMask;
        vToothPos = position;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D uMicroNoise;
        varying vec3 vToothMask;
        varying vec3 vToothPos;
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        // Один расчёт угла и границы шейки (CEJ) на пиксель + 2 быстрые выборки текстуры
        float pxTheta = atan(vToothPos.z, vToothPos.x);
        vec2 uvSide = vec2(pxTheta * 0.15915494, vToothPos.y * 0.62);
        vec2 uvTop = vToothPos.xz * 0.85;
        float topBlend = smoothstep(0.30, 0.58, vToothPos.y);
        vec2 nSample = mix(texture2D(uMicroNoise, uvSide).rg, texture2D(uMicroNoise, uvTop).rg, topBlend);
        float pxGrain = nSample.r;
        float pxFine = nSample.g;

        float pxCej = -0.36 + 0.075 * cos(2.0 * pxTheta) - 0.015 * sin(pxTheta);
        float microWave = (pxGrain - 0.5) * 0.020;
        float pxEnamel = smoothstep(pxCej - 0.026 + microWave, pxCej + 0.024 + microWave, vToothPos.y);
        float pxAO = vToothMask.y;

        vec3 cejEnamelTint = vec3(0.86, 0.80, 0.68);
        vec3 cejRootTint = vec3(0.73, 0.61, 0.44);
        float cejZone = exp(-pow((vToothPos.y - pxCej) / 0.095, 2.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(cejRootTint, cejEnamelTint, pxEnamel), cejZone * 0.36);

        float rootVar = (pxGrain - 0.5) * 0.065 + (pxFine - 0.5) * 0.035;
        diffuseColor.rgb *= mix(1.0 + rootVar, 1.0 + (pxGrain - 0.5) * 0.018, pxEnamel);
        diffuseColor.rgb *= (1.0 - pxAO * 0.22);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        float perikymata = sin(vToothPos.y * 105.0 + pxGrain * 3.4);
        float enamelRough = clamp(0.165 + perikymata * 0.018 + pxAO * 0.19, 0.12, 0.44);
        float rootRough = clamp(0.70 + (pxFine - 0.5) * 0.14 + pxAO * 0.08, 0.58, 0.88);
        roughnessFactor = mix(rootRough, enamelRough, pxEnamel);
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        // Лёгкий процедурный микрорельеф из уже прочитанной текстуры без лишних шумов
        float reliefEnamel = perikymata * 0.011;
        float reliefRoot = (pxFine - 0.5) * 0.052;
        float relief = mix(reliefRoot, reliefEnamel, pxEnamel);
        vec3 bumpOffset = vec3(dFdx(relief), dFdy(relief), 0.0);
        normal = normalize(normal - bumpOffset * mix(0.42, 0.20, pxEnamel));
        `
      )
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= pxEnamel * (1.0 - pxAO * 0.65);
          material.clearcoatRoughness = mix(0.45, 0.10 + pxAO * 0.12, pxEnamel);
        #endif
        material.specularColor *= mix(0.30, 1.0, pxEnamel);
        `
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        // Мягкое подповерхностное свечение (SSS) и опалесценция на просвет эмали
        float ndotv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float sssEdge = pow(1.0 - ndotv, 2.2) * pxEnamel * (0.28 + 0.72 * vToothMask.z);
        vec3 warmSSS = vec3(1.0, 0.87, 0.72) * sssEdge * 0.085;
        vec3 opalescentEdge = vec3(0.76, 0.90, 1.0) * pow(1.0 - ndotv, 3.0) * vToothMask.z * 0.048;
        outgoingLight += warmSSS + opalescentEdge;
        #include <opaque_fragment>
        `
      );
  };
  enamel.customProgramCacheKey = () => 'oris-dental-enamel-v3-tex';

  // Объёмная подсвеченная пульпа: лёгкий MeshStandardMaterial вместо второго MeshPhysicalMaterial
  const pulp = new THREE.MeshStandardMaterial({
    color: 0xd94b66,
    emissive: 0xff6e84,
    emissiveIntensity: 0.50,
    roughness: 0.34,
    metalness: 0.0,
    transparent: true,
    opacity: 0.94,
    depthWrite: true,
  });

  // Диагностический рентген-шейдер: чистый контур без пересветов, различает эмаль и корни.
  const xray = new THREE.ShaderMaterial({
    uniforms: {
      uCrownColor: { value: new THREE.Color(0x9ff4f6) },
      uRootColor: { value: new THREE.Color(0x5ec6dc) },
      uPower: { value: 2.05 },
      uOpacity: { value: 0.84 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCrownColor;
      uniform vec3 uRootColor;
      uniform float uPower;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vLocal;
      void main() {
        float ndotv = abs(dot(normalize(vN), normalize(vV)));
        float fresnel = pow(1.0 - ndotv, uPower);
        float theta = atan(vLocal.z, vLocal.x);
        float cej = -0.36 + 0.075 * cos(2.0 * theta) - 0.015 * sin(theta);
        float isCrown = smoothstep(cej - 0.06, cej + 0.06, vLocal.y);
        vec3 col = mix(uRootColor, uCrownColor, isCrown);
        float cejLine = exp(-pow((vLocal.y - cej) / 0.028, 2.0)) * 0.22;
        float alpha = clamp(fresnel * uOpacity + 0.065 + cejLine, 0.0, 0.92);
        gl_FragColor = vec4(col * (1.0 + fresnel * 0.28 + cejLine), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });

  return { enamel, pulp, xray, microNoiseTex };
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(12,42,85,0.26)');
  g.addColorStop(0.38, 'rgba(12,42,85,0.12)');
  g.addColorStop(0.72, 'rgba(12,42,85,0.035)');
  g.addColorStop(1, 'rgba(12,42,85,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  return t;
}

async function modelExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/* ---------- Вьюер ---------- */

export async function createToothViewer({ stage, host, layer, onSelect, onStatus }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSoftwareGl = detectSoftwareWebGL();
  const device = detectDeviceTier(isSoftwareGl);

  const dprCap = isSoftwareGl ? 1 : device.isLowPower ? 1.5 : 1.75;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, dprCap);

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    alpha: true,
    stencil: false,
    // Не принуждаем ноутбук переключаться на дискретную видеокарту
    powerPreference: device.isLowPower ? 'low-power' : 'default',
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.66;
  roomEnv.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  // Оптимизированный студийный свет: 2 направленных источника вместо 4 + сбалансированный HemisphereLight.
  // Вдвое меньше проходов прямого освещения в шейдере при сохранении студийного объёма.
  const key = new THREE.DirectionalLight(0xfff5e6, 1.75);
  key.position.set(-4.6, 5.8, 4.4);
  const rim = new THREE.DirectionalLight(0xa2e8ec, 0.82);
  rim.position.set(3.8, 2.2, -5.6);
  const hemi = new THREE.HemisphereLight(0xf0f7ff, 0xdfd3c2, 0.72);
  scene.add(key, rim, hemi);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 5.0;
  controls.maxDistance = 13;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.6;
  // На телефонах и экономичных устройствах — 0% фоновой нагрузки GPU (без авто-вращения).
  // На десктопе — короткая плавная презентация (8 сек) на 30 FPS, затем полный сон до взаимодействия.
  const allowIntroSpin = !reduceMotion && !device.isLowPower;
  controls.autoRotate = allowIntroSpin;
  controls.autoRotateSpeed = 0.55;

  // Колесо мыши прокручивает страницу; приближение — Ctrl + колесо или жест «щипок».
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    else e.preventDefault();
  };
  stage.addEventListener('wheel', onWheel, { capture: true, passive: false });

  const materials = createMaterials();
  const pivot = new THREE.Group();
  scene.add(pivot);

  // Загрузка модели
  let model;
  let source = 'procedural';
  if (await modelExists(MODEL_URL)) {
    try {
      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      model = gltf.scene;
      source = 'glb';
    } catch (err) {
      console.warn('[ORIS] Не удалось загрузить GLB, используется процедурная модель.', err);
    }
  }
  if (!model) model = await buildProceduralTooth(materials, device.quality);

  // Нормализуем размер и положение любой модели.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 3.0 / Math.max(size.y, size.x, size.z);
  model.position.sub(center).multiplyScalar(scale);
  model.scale.setScalar(scale);
  pivot.add(model);
  pivot.updateMatrixWorld(true);

  // Объект с именем «pulp» показывается только в режиме «Внутри».
  const pulpGroup = model.getObjectByName('pulp');
  if (pulpGroup) {
    pulpGroup.userData.xrayOnly = true;
    pulpGroup.visible = false;
  }
  const insidePulp = (o) => {
    for (let p = o; p; p = p.parent) if (p.userData?.xrayOnly) return true;
    return false;
  };
  const meshes = [];
  let triangleCount = 0;
  model.traverse((o) => {
    if (o.isMesh && !insidePulp(o)) {
      o.userData.baseMaterial = o.material;
      meshes.push(o);
      if (o.geometry?.index) triangleCount += o.geometry.index.count / 3;
      else if (o.geometry?.attributes?.position) triangleCount += o.geometry.attributes.position.count / 3;
    }
  });

  // Ленивая сборка пульпы при первом переключении в режим «Внутри»
  let pulpPromise = null;
  function ensurePulp() {
    if (!pulpGroup || !pulpGroup.userData.lazyProcedural) return Promise.resolve();
    if (pulpGroup.children.length > 0) return Promise.resolve();
    if (!pulpPromise) {
      pulpPromise = computeToothPart(pulpGroup.userData.quality || device.quality, 'pulp').then(({ pulp: pulpData }) => {
        if (disposed || !pulpData) return;
        const pulpMesh = new THREE.Mesh(toGeometry(pulpData), materials.pulp);
        pulpMesh.name = 'pulp-mesh';
        pulpMesh.renderOrder = 1;
        pulpGroup.add(pulpMesh);
        if (pulpMesh.geometry?.index) triangleCount += pulpMesh.geometry.index.count / 3;
        if (xray) requestRender();
      });
    }
    return pulpPromise;
  }

  const fitted = new THREE.Box3().setFromObject(model);
  const fSize = fitted.getSize(new THREE.Vector3());

  const shadowMapTex = shadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowMapTex, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(Math.max(fSize.x, fSize.z) * 2.25);
  shadow.position.y = fitted.min.y - 0.24;
  scene.add(shadow);

  // Точки-подсказки: raycast к поверхности.
  const ray = new THREE.Raycaster();
  const hotspots = HOTSPOTS.map((h) => {
    const pr = h.probe;
    let origin;
    let dir;
    if (pr.type === 'top') {
      origin = new THREE.Vector3(pr.x * fSize.x, fitted.max.y + 2, pr.z * fSize.z);
      dir = new THREE.Vector3(0, -1, 0);
    } else {
      const a = THREE.MathUtils.degToRad(pr.angle);
      const y = fitted.min.y + pr.h * fSize.y;
      dir = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
      origin = new THREE.Vector3(Math.sin(a) * 10, y, Math.cos(a) * 10);
    }
    ray.set(origin, dir);
    const hit = ray.intersectObjects(meshes, false)[0];
    const point = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, 9);
    const normal = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    point.addScaledVector(normal, 0.02);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hotspot';
    btn.dataset.id = h.id;
    btn.setAttribute('aria-label', `${h.label}: показать пояснение`);
    btn.innerHTML = `<span class="hotspot__dot" aria-hidden="true"></span><span class="hotspot__label">${h.label}</span>`;
    layer.appendChild(btn);
    btn.addEventListener('click', () => select(h.id, true));
    return { ...h, point, normal, btn, lastX: NaN, lastY: NaN, lastHidden: null, lastLeft: null };
  });

  /* Камера и анимации */
  const sph = new THREE.Spherical();
  const tmpCamOffset = new THREE.Vector3();
  const prevCamPos = new THREE.Vector3();
  const prevCamQuat = new THREE.Quaternion();
  const tween = { active: false };

  function setCameraFromSpherical(s) {
    camera.position.setFromSpherical(s);
    camera.lookAt(controls.target);
  }
  function currentSpherical() {
    tmpCamOffset.copy(camera.position).sub(controls.target);
    return new THREE.Spherical().setFromVector3(tmpCamOffset);
  }
  function animateTo({ theta, phi, radius }, duration = 900) {
    const from = currentSpherical();
    let dt = theta - from.theta;
    dt = Math.atan2(Math.sin(dt), Math.cos(dt));
    const to = {
      theta: from.theta + dt,
      phi,
      radius: THREE.MathUtils.clamp(radius, controls.minDistance, controls.maxDistance),
    };
    stopAutoRotate();
    if (reduceMotion || isSoftwareGl) {
      tween.active = false;
      sph.set(to.radius, to.phi, to.theta);
      setCameraFromSpherical(sph);
      controls.update();
      requestRender();
      return;
    }
    Object.assign(tween, { active: true, start: performance.now(), duration, from, to });
    requestRender();
  }

  // Короткое вступительное вращение на десктопе, затем полный сон GPU (0 FPS)
  let introSleepTimer = 0;
  function stopAutoRotate() {
    controls.autoRotate = false;
    clearTimeout(introSleepTimer);
    introSleepTimer = 0;
  }
  if (allowIntroSpin) {
    introSleepTimer = window.setTimeout(() => {
      controls.autoRotate = false;
    }, 8000);
  }

  let pointerActive = false;
  controls.addEventListener('start', () => {
    pointerActive = true;
    tween.active = false;
    stopAutoRotate();
    requestRender();
  });
  controls.addEventListener('end', () => {
    pointerActive = false;
    requestRender();
  });

  /* Выбор точки */
  let activeId = null;
  function select(id, moveCamera = false) {
    activeId = activeId === id ? null : id;
    hotspots.forEach((h) => h.btn.classList.toggle('is-active', h.id === activeId));
    const h = hotspots.find((x) => x.id === activeId);
    onSelect?.(h ? { id: h.id, label: h.label, text: h.text } : xray ? { id: 'xray', ...XRAY_TEXT } : null);
    if (h && moveCamera) {
      const n = h.point.clone().setY(0);
      const theta = Math.atan2(n.x, n.z);
      const phi = h.probe.type === 'top' ? 0.52 : THREE.MathUtils.clamp(1.57 - (h.point.y / fSize.y) * 0.9, 0.6, 2.1);
      animateTo({ theta, phi, radius: 7.3 }, 950);
    }
  }

  /* Режим «просвет» */
  let xray = false;
  function setXray(on) {
    xray = on;
    meshes.forEach((m) => (m.material = on ? materials.xray : m.userData.baseMaterial));
    if (pulpGroup) {
      pulpGroup.visible = on;
      if (on) ensurePulp();
    }
    shadow.visible = !on;
    stage.classList.toggle('is-xray', on);
    activeId = null;
    hotspots.forEach((h) => h.btn.classList.remove('is-active'));
    onSelect?.(on ? { id: 'xray', ...XRAY_TEXT } : null);
    requestRender();
  }

  /* Размеры (кэшируем width/height, чтобы не вызывать layout thrashing в цикле рендера) */
  let hostW = 0;
  let hostH = 0;
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    hostW = r.width;
    hostH = r.height;
    renderer.setSize(hostW, hostH, false);
    camera.aspect = hostW / hostH;
    camera.fov = camera.aspect < 0.8 ? 38 : 30;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  /* Проекция точек на экран без лишних DOM-записей */
  const projVec = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  function updateHotspots() {
    if (!hostW || !hostH) return;
    for (let i = 0; i < hotspots.length; i++) {
      const h = hotspots[i];
      projVec.copy(h.point).applyMatrix4(pivot.matrixWorld);
      toCam.copy(camera.position).sub(projVec).normalize();
      const facing = h.normal.dot(toCam);
      projVec.project(camera);
      const x = Math.round((projVec.x * 0.5 + 0.5) * hostW * 2) * 0.5;
      const y = Math.round((-projVec.y * 0.5 + 0.5) * hostH * 2) * 0.5;
      const hidden = facing < -0.05 || xray;
      const left = x > hostW * 0.62;

      if (x !== h.lastX || y !== h.lastY) {
        h.btn.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        h.lastX = x;
        h.lastY = y;
      }
      if (hidden !== h.lastHidden) {
        h.btn.classList.toggle('is-hidden', hidden);
        h.btn.tabIndex = hidden ? -1 : 0;
        h.lastHidden = hidden;
      }
      if (left !== h.lastLeft) {
        h.btn.classList.toggle('is-left', left);
        h.lastLeft = left;
      }
    }
  }

  /* Энергоэффективный цикл рендера: 0 FPS в покое, плавный FPS при действии */
  let visible = true;
  let disposed = false;
  let contextLost = false;
  let raf = 0;
  let syncTimer = 0;
  let renderBusy = false;
  let renderDirty = false;
  let lastFrameTime = 0;
  let framesRendered = 0;
  let isIdle = true;

  function afterDraw(cb) {
    const gl = renderer.getContext();
    if (typeof gl.fenceSync !== 'function') {
      syncTimer = window.setTimeout(cb, 60);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        syncTimer = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        syncTimer = window.setTimeout(cb, 60);
      }
    };
    syncTimer = window.setTimeout(poll, 5);
  }

  function renderFrame(now) {
    raf = 0;
    if (disposed || contextLost) {
      isIdle = true;
      return;
    }

    // Ограничиваем частоту кадров: 30 FPS для фоновой презентации и <=60 FPS при управлении
    // (чтобы экраны 120/144/240 Гц не грели GPU впустую).
    if (!isSoftwareGl && lastFrameTime) {
      const activeMotion = pointerActive || tween.active;
      const minInterval = activeMotion ? 15 : controls.autoRotate ? 32 : 15;
      if (now - lastFrameTime < minInterval) {
        if (visible && !document.hidden) raf = requestAnimationFrame(renderFrame);
        return;
      }
    }
    lastFrameTime = now || performance.now();

    if (tween.active) {
      const k = Math.min(1, (lastFrameTime - tween.start) / tween.duration);
      const e = ease(k);
      sph.set(
        THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, e),
        THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, e),
        THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, e)
      );
      setCameraFromSpherical(sph);
      if (k >= 1) tween.active = false;
    }

    prevCamPos.copy(camera.position);
    prevCamQuat.copy(camera.quaternion);
    controls.update();

    renderer.render(scene, camera);
    framesRendered++;
    updateHotspots();

    if (isSoftwareGl) {
      afterDraw(() => {
        renderBusy = false;
        if (renderDirty) {
          renderDirty = false;
          requestRender();
        } else {
          isIdle = true;
        }
      });
      return;
    }

    // Проверяем, продолжает ли камера двигаться (инерция damping, перетаскивание, tween или интро-поворот)
    const camMoved =
      prevCamPos.distanceToSquared(camera.position) > 1e-8 ||
      Math.abs(1 - Math.abs(prevCamQuat.dot(camera.quaternion))) > 1e-7;

    const shouldContinue = visible && !document.hidden && (pointerActive || tween.active || controls.autoRotate || camMoved);
    if (shouldContinue) {
      isIdle = false;
      raf = requestAnimationFrame(renderFrame);
    } else {
      // Полный покой: 0 вызовов rAF, 0% нагрузки на GPU и батарею!
      isIdle = true;
    }
  }

  function requestRender() {
    if (disposed || contextLost) return;
    isIdle = false;
    if (isSoftwareGl) {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      raf = requestAnimationFrame(renderFrame);
    } else if (!raf) {
      raf = requestAnimationFrame(renderFrame);
    }
  }

  const onContextLost = (e) => {
    e.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    isIdle = true;
  };
  const onContextRestored = () => {
    contextLost = false;
    requestRender();
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      requestRender();
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      isIdle = true;
    }
  });
  intersectionObserver.observe(stage);

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        isIdle = true;
      }
    } else if (visible) {
      requestRender();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  controls.addEventListener('change', requestRender);

  setCameraFromSpherical(new THREE.Spherical(VIEWS.overview.radius, VIEWS.overview.phi, VIEWS.overview.theta));
  if (!isSoftwareGl) renderer.compile(scene, camera);
  resize();
  requestRender();
  onStatus?.({ source });

  return {
    source,
    get stats() {
      return {
        tier: device.tier,
        quality: device.quality,
        triangles: Math.round(triangleCount),
        pixelRatio,
        isIdle,
        framesRendered,
        pulpLoaded: !pulpGroup || !pulpGroup.userData.lazyProcedural || pulpGroup.children.length > 0,
      };
    },
    view(name) {
      if (VIEWS[name]) animateTo(VIEWS[name], 950);
    },
    zoom(factor) {
      const s = currentSpherical();
      animateTo({ theta: s.theta, phi: s.phi, radius: s.radius * factor }, 450);
    },
    reset() {
      if (activeId) select(activeId);
      if (xray) setXray(false);
      animateTo(VIEWS.overview, 950);
    },
    setXray,
    get xray() {
      return xray;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(syncTimer);
      clearTimeout(introSleepTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stage.removeEventListener('wheel', onWheel, { capture: true });
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      hotspots.forEach((h) => h.btn.remove());
      model.traverse((o) => {
        if (o.isMesh) o.geometry?.dispose();
      });
      materials.enamel.dispose();
      materials.pulp.dispose();
      materials.xray.dispose();
      materials.microNoiseTex.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowMapTex.dispose();
      envTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
