// world.js — builds the three.js scene for Slagworks from the data in map.js:
// one box mesh per wall (shared materials, so the whole map is a few dozen draw
// calls), a painted concrete ground, a gradient dusk sky, skyline silhouettes,
// sodium lamps, and the furnace's molten glow. Rendering only: nothing here
// decides anything about the game, and the simulation never reads the scene.

import * as THREE from 'three';
import { WALLS, SITES, BOUNDS } from './map.js';
import { PALETTE } from './palette.js';

const LAMPS = [
  [-24, 16], [24, 16], [0, -20], [-26, -8], [26, -8], [-34, -20], [34, -20], [0, 40],
];

let furnaceLight = null;
let furnaceGlowMat = null;
let dust = null;
let dustPos = null;

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  const W = BOUNDS.maxX - BOUNDS.minX;
  const H = BOUNDS.maxZ - BOUNDS.minZ;
  const px = (x) => ((x - BOUNDS.minX) / W) * 1024;
  const pz = (z) => ((z - BOUNDS.minZ) / H) * 1024;
  const sx = 1024 / W;
  const sz = 1024 / H;

  g.fillStyle = '#434345';
  g.fillRect(0, 0, 1024, 1024);
  // worn concrete: soft blotches and speckle
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const r = 4 + Math.random() * 26;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  for (let y = 0; y <= 1024; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }

  // painted site circles and letters
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    g.strokeStyle = key === 'A' ? 'rgba(216,84,46,0.85)' : 'rgba(232,163,61,0.85)';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(px(s.x), pz(s.z), s.r * sx, s.r * sz, 0, 0, 7);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.font = `bold ${Math.round(9 * sx)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key, px(s.x), pz(s.z));
  }
  // lane guide dashes down the middle of the yard
  g.fillStyle = 'rgba(233,230,223,0.20)';
  for (let z = 16; z < 36; z += 4) g.fillRect(px(-0.4), pz(z), 0.8 * sx, 2 * sz);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function skyDome() {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x24314d) },
      horizon: { value: new THREE.Color(0x9c5c2a) },
      bottom: { value: new THREE.Color(0x232323) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;' +
      'void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.45)) : mix(horizon, bottom, pow(-h, 0.6)); gl_FragColor = vec4(c, 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 190);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 500);

  scene.add(skyDome());

  const hemi = new THREE.HemisphereLight(0x93a9cf, 0x4a4034, 1.15);
  scene.add(hemi);
  // The dusk sun sits south-west, so the faces a player reads while pushing
  // north — hall fronts, the core, the yard walls — carry the warm light.
  const sun = new THREE.DirectionalLight(0xffc38a, 1.9);
  sun.position.set(-45, 62, 48);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6d88b5, 0.85);
  fill.position.set(50, 26, -40);
  scene.add(fill);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(BOUNDS.maxX - BOUNDS.minX + 24, BOUNDS.maxZ - BOUNDS.minZ + 24),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Walls and props: one mesh per box, materials shared by palette key.
  const mats = {};
  for (const key of ['wall', 'wallDark', 'metal', 'metalDark', 'rust', 'crate', 'crateDark', 'barrel']) {
    mats[key] = new THREE.MeshStandardMaterial({ color: PALETTE[key], roughness: 0.92, metalness: key.includes('metal') ? 0.35 : 0.02 });
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const w of WALLS) {
    const mesh = new THREE.Mesh(unitBox, mats[w.mat]);
    mesh.scale.set(w.maxX - w.minX, w.h, w.maxZ - w.minZ);
    mesh.position.set((w.minX + w.maxX) / 2, w.h / 2, (w.minZ + w.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // The furnace mouth: a glowing slit on the furnace block inside hall A.
  furnaceGlowMat = new THREE.MeshBasicMaterial({ color: PALETTE.furnaceGlow });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), furnaceGlowMat);
  mouth.position.set(-36.4, 1.1, -35);
  mouth.rotation.y = Math.PI / 2;
  scene.add(mouth);
  furnaceLight = new THREE.PointLight(PALETTE.furnaceGlow, 60, 26, 1.8);
  furnaceLight.position.set(-35, 2.2, -35);
  scene.add(furnaceLight);

  // Core rooftop dressing: vents, pipes and two chimney stacks.
  const metal = mats.metal;
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), metal);
  vent.position.set(-5, 7.8, -4);
  vent.castShadow = true;
  scene.add(vent);
  const vent2 = vent.clone();
  vent2.position.set(6, 7.8, 3);
  scene.add(vent2);
  for (const sx of [-30, 30]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 12, 12), mats.metalDark);
    stack.position.set(sx, 6, -47);
    stack.castShadow = true;
    scene.add(stack);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    beacon.position.set(sx, 12.3, -47);
    beacon.name = 'beacon';
    scene.add(beacon);
  }

  // Sodium lamps: pole, head and a real light on every other one (light count
  // stays small; the rest glow by emissive alone).
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
  const headGeo = new THREE.SphereGeometry(0.3, 10, 8);
  const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  LAMPS.forEach(([x, z], i) => {
    const pole = new THREE.Mesh(poleGeo, mats.metalDark);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(x, 5.5, z);
    scene.add(head);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(PALETTE.lamp, 42, 24, 1.9);
      light.position.set(x, 5.3, z);
      scene.add(light);
    }
  });

  // Site signs: a floating letter over each hall so the sites read at a glance.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = key === 'A' ? '#d8542e' : '#e8a33d';
    g.beginPath();
    g.arc(64, 64, 58, 0, 7);
    g.fill();
    g.fillStyle = '#14161a';
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(s.x, 6.4, s.z);
    sign.name = 'siteSign' + key;
    scene.add(sign);
  }

  // Distant skyline: fog-tinted factory silhouettes against the dusk.
  const silMat = new THREE.MeshBasicMaterial({ color: 0x272f3d });
  const silGeo = new THREE.BoxGeometry(1, 1, 1);
  const skylineSpots = [
    [-105, -95, 30, 26], [-45, -105, 22, 18], [15, -100, 34, 30], [75, -95, 24, 20],
    [110, -25, 26, 24], [108, 35, 20, 16], [50, 105, 30, 20], [-25, 108, 34, 22],
    [-100, 45, 24, 18], [-108, -15, 28, 26],
  ];
  for (const [x, z, w, h] of skylineSpots) {
    const m = new THREE.Mesh(silGeo, silMat);
    m.scale.set(w, h, 10);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }

  // Drifting dust in the lamplight: a few hundred points, wrapped in a volume.
  const N = 260;
  dustPos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 100;
    dustPos[i * 3 + 1] = Math.random() * 7 + 0.3;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 108;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  scene.add(dust);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

// Per-frame dressing: furnace pulse, sign billboarding, dust drift.
export function updateWorldVisuals(scene, t, dt) {
  if (furnaceLight) furnaceLight.intensity = 55 + Math.sin(t * 7.3) * 7 + Math.sin(t * 17.7) * 4;
  if (furnaceGlowMat) furnaceGlowMat.color.setHSL(0.06, 0.95, 0.52 + Math.sin(t * 9.1) * 0.05);
  if (dust && dustPos) {
    for (let i = 0; i < dustPos.length; i += 3) {
      dustPos[i] += dt * 0.35;
      dustPos[i + 1] += Math.sin(t * 0.7 + i) * dt * 0.05;
      if (dustPos[i] > 52) dustPos[i] = -52;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }
  for (const key of ['A', 'B']) {
    const sign = scene.getObjectByName('siteSign' + key);
    if (sign) sign.rotation.y = t * 0.4;
  }
}
