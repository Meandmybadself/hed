import './style.css';

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Raycaster,
  RectAreaLight,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

const appEl = document.querySelector<HTMLDivElement>('#app');
if (!appEl) throw new Error('Missing #app element');
const app = appEl;

const renderer = new WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#090D18');

const camera = new PerspectiveCamera(45, 1, 0.01, 1000);

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 6, 5);
scene.add(sun);

RectAreaLightUniformsLib.init();
const areaKey = new RectAreaLight(0xffffff, 6, 3, 3);
scene.add(areaKey);
function placeAreaLightRelativeToCamera(distanceScale = 0.25) {
  const dir = new Vector3();
  camera.getWorldDirection(dir); // points "forward" from camera

  const up = new Vector3(0, 1, 0);
  const left = up.clone().cross(dir).normalize();
  const behind = dir.clone().multiplyScalar(-1);

  const camDist = camera.position.distanceTo(new Vector3(0, 0, 0));
  const offset = Math.max(0.5, camDist * distanceScale);

  areaKey.position
    .copy(camera.position)
    .add(behind.multiplyScalar(offset * 0.35))
    .add(left.multiplyScalar(offset))
    .add(up.multiplyScalar(offset * 0.15));
  areaKey.lookAt(0, 0, 0);
}

const loader = new GLTFLoader();
const raycaster = new Raycaster();
const ndc = new Vector2();

let modelRoot: any = null;
let modelBox = new Box3();

function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  if (modelRoot) fitCameraToModel();
  else placeAreaLightRelativeToCamera();
}

function fitCameraToModel() {
  if (!modelRoot) return;

  modelBox = new Box3().setFromObject(modelRoot);
  const size = modelBox.getSize(new Vector3());
  const center = modelBox.getCenter(new Vector3());

  // Recenter model at origin so rotation feels natural.
  modelRoot.position.sub(center);

  // Recompute after recentering.
  modelBox = new Box3().setFromObject(modelRoot);
  const newSize = modelBox.getSize(new Vector3());

  const vFov = (camera.fov * Math.PI) / 180;
  const halfY = newSize.y / 2;
  const halfX = newSize.x / 2;
  const aspect = camera.aspect;

  const distForHeight = halfY / Math.tan(vFov / 2);
  const distForWidth = halfX / (Math.tan(vFov / 2) * aspect);

  const dist = Math.max(distForHeight, distForWidth);
  const padding = 1.08;
  const camDist = dist * padding + newSize.z / 2;

  camera.position.set(0, 0, camDist);
  camera.near = Math.max(camDist / 1000, 0.001);
  camera.far = camDist * 1000;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  placeAreaLightRelativeToCamera();
}

loader.load(
  '/assets/hed-0.glb',
  (gltf: any) => {
    modelRoot = gltf.scene;
    modelRoot.rotation.order = 'YXZ';
    modelRoot.rotation.set(REST_X, REST_Y, REST_Z);
    scene.add(modelRoot);
    fitCameraToModel();
  },
  undefined,
  (err: unknown) => {
    console.error('Failed to load GLB', err);
  },
);

// --- Grab-to-rotate (click-drag on model only) ---
let dragging = false;
let activePointerId: number | null = null;
let lastClientX = 0;
let lastClientY = 0;

const ROTATE_SPEED = 0.007; // radians per pixel
const MAX_ANGLE = (40 * Math.PI) / 180;
const REST_X = (10 * Math.PI) / 180;
const REST_Y = 0;
const REST_Z = 0;
const SPRING_K = 120; // stiffness (higher = snaps back faster)
const SPRING_C = 7; // damping (lower = springier / more bounce)
const SPRING_EPS_ANGLE = 0.0005;
const SPRING_EPS_VEL = 0.0005;

const rotVel = new Vector3(0, 0, 0);

function clampAngle(a: number, target: number) {
  return Math.max(target - MAX_ANGLE, Math.min(target + MAX_ANGLE, a));
}

function stepSpringAxis(angle: number, vel: number, target: number, dt: number): [number, number] {
  const x = angle - target;
  const acc = -SPRING_K * x - SPRING_C * vel;
  const nextVel = vel + acc * dt;
  const nextAngle = angle + nextVel * dt;
  return [nextAngle, nextVel];
}

function setCursor(cursor: string) {
  renderer.domElement.style.cursor = cursor;
}

function updateNdcFromEvent(e: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
}

function hitTest(e: PointerEvent): boolean {
  if (!modelRoot) return false;
  updateNdcFromEvent(e);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(modelRoot, true);
  return hits.length > 0;
}

renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!modelRoot) return;
  if (e.button !== 0) return;
  if (!hitTest(e)) return;

  dragging = true;
  activePointerId = e.pointerId;
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  rotVel.set(0, 0, 0);
  renderer.domElement.setPointerCapture(e.pointerId);
  setCursor('grabbing');
});

renderer.domElement.addEventListener('pointermove', (e: PointerEvent) => {
  if (!modelRoot) return;

  if (dragging && activePointerId === e.pointerId) {
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    modelRoot.rotation.y = clampAngle(modelRoot.rotation.y + dx * ROTATE_SPEED, REST_Y);
    modelRoot.rotation.x = clampAngle(modelRoot.rotation.x + dy * ROTATE_SPEED, REST_X);
    // Small roll for "grab" feel; still constrained.
    modelRoot.rotation.z = clampAngle(modelRoot.rotation.z + dx * ROTATE_SPEED * 0.35, REST_Z);
    return;
  }

  // Hover affordance
  if (hitTest(e)) setCursor('grab');
  else setCursor('default');
});

function endDrag(e: PointerEvent) {
  if (!dragging) return;
  if (activePointerId !== e.pointerId) return;

  dragging = false;
  activePointerId = null;
  try {
    renderer.domElement.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  setCursor(hitTest(e) ? 'grab' : 'default');
}

renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('lostpointercapture', () => {
  dragging = false;
  activePointerId = null;
  setCursor('default');
});

window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.033, (now - lastFrameMs) / 1000);
  lastFrameMs = now;

  if (modelRoot && !dragging) {
    // Elastic bounce back to rest orientation with constraints.
    let [rx, vx] = stepSpringAxis(modelRoot.rotation.x, rotVel.x, REST_X, dt);
    let [ry, vy] = stepSpringAxis(modelRoot.rotation.y, rotVel.y, REST_Y, dt);
    let [rz, vz] = stepSpringAxis(modelRoot.rotation.z, rotVel.z, REST_Z, dt);

    rx = clampAngle(rx, REST_X);
    ry = clampAngle(ry, REST_Y);
    rz = clampAngle(rz, REST_Z);

    // Snap when settled.
    if (Math.abs(rx - REST_X) < SPRING_EPS_ANGLE && Math.abs(vx) < SPRING_EPS_VEL) {
      rx = REST_X;
      vx = 0;
    }
    if (Math.abs(ry - REST_Y) < SPRING_EPS_ANGLE && Math.abs(vy) < SPRING_EPS_VEL) {
      ry = REST_Y;
      vy = 0;
    }
    if (Math.abs(rz - REST_Z) < SPRING_EPS_ANGLE && Math.abs(vz) < SPRING_EPS_VEL) {
      rz = REST_Z;
      vz = 0;
    }

    modelRoot.rotation.set(rx, ry, rz);
    rotVel.set(vx, vy, vz);
  }
  renderer.render(scene, camera);
}
let lastFrameMs = performance.now();
animate();


