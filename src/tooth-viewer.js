// Интерактивная 3D-модель зуба для hero-блока.
// 1. Пытается загрузить /models/dental-tooth.glb (файл из /public/models/).
// 2. Если файла нет — строит процедурную модель моляра (заглушку).
// Информационные точки задаются в нормализованных координатах и
// «прилипают» к поверхности любой модели через raycast, поэтому
// после замены GLB их не нужно пересчитывать вручную.

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
    probe: { type: 'top', x: 0.2, z: 0.18 },
  },
  {
    id: 'enamel',
    label: 'Эмаль',
    text: 'Самая твёрдая ткань организма и защитный слой коронки. Эмаль не восстанавливается сама, поэтому её берегут: регулярная гигиена и осмотры.',
    probe: { type: 'side', h: 0.86, angle: -28 },
  },
  {
    id: 'neck',
    label: 'Шейка зуба',
    text: 'Место, где коронка переходит в корень. Обычно её закрывает десна. Если десна воспалена, шейка может стать чувствительной.',
    probe: { type: 'side', h: 0.67, angle: 34 },
  },
  {
    id: 'roots',
    label: 'Корни',
    text: 'Удерживают зуб в челюсти. Их не видно при обычном осмотре — состояние корней врач оценивает по снимку.',
    probe: { type: 'side', h: 0.3, angle: 12 },
  },
];

const XRAY_TEXT = {
  label: 'Внутри зуба',
  text: 'В центре зуба находится пульпа — нерв и сосуды. Она проходит по каналам внутри корней. Когда воспаление доходит до пульпы, врач лечит каналы.',
};

const VIEWS = {
  overview: { theta: 0.55, phi: 1.32, radius: 9.2 },
  top: { theta: 0.2, phi: 0.42, radius: 7.6 },
  roots: { theta: 2.6, phi: 1.92, radius: 8.6 },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- Процедурная модель-заглушка (моляр) ---------- */
// Геометрия строится по полю расстояний (src/tooth-sdf.js) в Web Worker:
// одна гладкая замкнутая поверхность без швов, нормали — из градиента поля.

function computeToothData(quality) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (data) => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    const fallback = async () => {
      const { buildToothData } = await import('./tooth-sdf.js');
      finish(buildToothData({ quality }));
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
      worker.postMessage({ quality });
    } catch {
      fallback();
    }
  });
}

function toGeometry({ position, normal, color, index }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

async function buildProceduralTooth(materials) {
  const lowEnd = window.matchMedia('(max-width: 720px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const data = await computeToothData(lowEnd ? 'low' : 'high');

  const group = new THREE.Group();
  group.name = 'procedural-tooth';
  const tooth = new THREE.Mesh(toGeometry(data.tooth), materials.enamel);
  tooth.name = 'tooth';
  group.add(tooth);

  const pulp = new THREE.Group();
  pulp.name = 'pulp';
  pulp.add(new THREE.Mesh(toGeometry(data.pulp), materials.pulp));
  group.add(pulp);
  return group;
}

/* ---------- Материалы ---------- */

function createMaterials() {
  // Эмаль: мягкий блеск и тёплое «подповерхностное» свечение по краям.
  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.16,
    sheen: 0.8,
    sheenColor: new THREE.Color(0xfff1e0),
    sheenRoughness: 0.55,
    ior: 1.62,
    specularIntensity: 0.65,
    specularColor: new THREE.Color(0xfffaf2),
  });
  const pulp = new THREE.MeshBasicMaterial({ color: 0xff8f9e, transparent: true, opacity: 0.78, depthWrite: false });
  const xray = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x7fe9ec) },
      uPower: { value: 1.7 },
      uOpacity: { value: 0.95 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        gl_FragColor = vec4(uColor, clamp(f * uOpacity + 0.035, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return { enamel, pulp, xray };
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(12,42,85,0.32)');
  g.addColorStop(0.45, 'rgba(12,42,85,0.12)');
  g.addColorStop(1, 'rgba(12,42,85,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.62;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 5);
  const rim = new THREE.DirectionalLight(0x6fdde0, 2.2);
  rim.position.set(5, 2, -6);
  const fill = new THREE.DirectionalLight(0xdbe7ff, 0.5);
  fill.position.set(3, -2, 6);
  scene.add(key, rim, fill, new THREE.HemisphereLight(0xffffff, 0xcfdde6, 0.35));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 5.2;
  controls.maxDistance = 13;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.6;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.7;

  // Колесо мыши прокручивает страницу; приближение — Ctrl + колесо или жест «щипок».
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      else e.preventDefault();
    },
    { capture: true, passive: false }
  );

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
      console.warn('[ORIS] Не удалось загрузить GLB, используется модель-заглушка.', err);
    }
  }
  if (!model) model = await buildProceduralTooth(materials);

  // Нормализуем размер и положение любой модели.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 3.0 / Math.max(size.y, size.x, size.z);
  model.position.sub(center).multiplyScalar(scale);
  model.scale.setScalar(scale);
  pivot.add(model);
  pivot.updateMatrixWorld(true);

  // Объект с именем «pulp» (если есть в GLB) показывается только в режиме «Внутри».
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
  model.traverse((o) => {
    if (o.isMesh && !insidePulp(o)) {
      o.userData.baseMaterial = o.material;
      meshes.push(o);
    }
  });

  const fitted = new THREE.Box3().setFromObject(model);
  const fSize = fitted.getSize(new THREE.Vector3());

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.setScalar(Math.max(fSize.x, fSize.z) * 2.1);
  shadow.position.y = fitted.min.y - 0.25;
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
    return { ...h, point, normal, btn };
  });

  /* Камера и анимации */
  const sph = new THREE.Spherical();
  const tween = { active: false };
  function setCameraFromSpherical(s) {
    camera.position.setFromSpherical(s);
    camera.lookAt(controls.target);
  }
  function currentSpherical() {
    return new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  }
  function animateTo({ theta, phi, radius }, duration = 1000) {
    const from = currentSpherical();
    // Кратчайший путь по углу theta
    let dt = theta - from.theta;
    dt = Math.atan2(Math.sin(dt), Math.cos(dt));
    const to = { theta: from.theta + dt, phi, radius: THREE.MathUtils.clamp(radius, controls.minDistance, controls.maxDistance) };
    pauseAuto();
    if (reduceMotion) {
      setCameraFromSpherical(new THREE.Spherical(to.radius, to.phi, to.theta));
      controls.update();
      requestRender();
      return;
    }
    Object.assign(tween, { active: true, start: performance.now(), duration, from, to });
    requestRender();
  }

  let resumeTimer;
  function pauseAuto() {
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
    if (!reduceMotion) resumeTimer = setTimeout(() => (controls.autoRotate = true), 7000);
  }
  controls.addEventListener('start', () => {
    tween.active = false;
    pauseAuto();
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
      const phi = h.probe.type === 'top' ? 0.55 : THREE.MathUtils.clamp(1.57 - (h.point.y / fSize.y) * 0.9, 0.6, 2.1);
      animateTo({ theta, phi, radius: 7.4 }, 1100);
    }
  }

  /* Режим «просвет» */
  let xray = false;
  function setXray(on) {
    xray = on;
    meshes.forEach((m) => (m.material = on ? materials.xray : m.userData.baseMaterial));
    if (pulpGroup) pulpGroup.visible = on;
    shadow.visible = !on;
    stage.classList.toggle('is-xray', on);
    // В режиме «Внутри» точки скрыты, поэтому снимаем выбор и показываем пояснение о пульпе.
    activeId = null;
    hotspots.forEach((h) => h.btn.classList.remove('is-active'));
    onSelect?.(on ? { id: 'xray', ...XRAY_TEXT } : null);
    requestRender();
  }

  /* Размеры */
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    // На узких экранах отодвигаем камеру, чтобы модель целиком помещалась.
    camera.fov = camera.aspect < 0.8 ? 38 : 30;
    camera.updateProjectionMatrix();
    requestRender();
  }
  new ResizeObserver(resize).observe(host);

  /* Проекция точек на экран */
  const v = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  function updateHotspots() {
    const w = host.clientWidth;
    const hgt = host.clientHeight;
    for (const h of hotspots) {
      v.copy(h.point).applyMatrix4(pivot.matrixWorld);
      toCam.copy(camera.position).sub(v).normalize();
      const facing = h.normal.dot(toCam);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * hgt;
      h.btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const hidden = facing < -0.05 || xray;
      h.btn.classList.toggle('is-hidden', hidden);
      h.btn.tabIndex = hidden ? -1 : 0;
      h.btn.classList.toggle('is-left', x > w * 0.62);
    }
  }

  /* Цикл рендера: только когда сцена видна */
  let visible = true;
  let raf = 0;
  const clock = new THREE.Clock();
  function frame() {
    raf = 0;
    const t = clock.getElapsedTime();
    if (tween.active) {
      const k = Math.min(1, (performance.now() - tween.start) / tween.duration);
      const e = ease(k);
      sph.set(
        THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, e),
        THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, e),
        THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, e)
      );
      setCameraFromSpherical(sph);
      if (k >= 1) tween.active = false;
    }
    if (!reduceMotion) pivot.position.y = Math.sin(t * 0.9) * 0.05;
    pivot.updateMatrixWorld();
    controls.update();
    renderer.render(scene, camera);
    updateHotspots();
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function requestRender() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestRender();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => !document.hidden && requestRender());
  controls.addEventListener('change', requestRender);

  setCameraFromSpherical(new THREE.Spherical(VIEWS.overview.radius, VIEWS.overview.phi, VIEWS.overview.theta));
  resize();
  requestRender();
  onStatus?.({ source });

  return {
    source,
    view(name) {
      if (VIEWS[name]) animateTo(VIEWS[name], 1100);
    },
    zoom(factor) {
      const s = currentSpherical();
      animateTo({ theta: s.theta, phi: s.phi, radius: s.radius * factor }, 500);
    },
    reset() {
      if (activeId) select(activeId);
      if (xray) setXray(false);
      animateTo(VIEWS.overview, 1100);
    },
    setXray,
    get xray() {
      return xray;
    },
  };
}
