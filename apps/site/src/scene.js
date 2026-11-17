import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  PointLight,
  RingGeometry,
  Scene,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

const BLUE = 0x0075df;
const ORANGE = 0xfc8b01;
const NAVY = 0x050d1f;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** A low-poly coach built from simple shapes, facing +z. */
function buildCoach() {
  const bus = new Group();
  const paint = new MeshStandardMaterial({
    color: 0xeaf2ff,
    metalness: 0.05,
    roughness: 0.45,
    emissive: 0x2a4a88,
    emissiveIntensity: 0.12,
  });
  const blue = new MeshStandardMaterial({ color: BLUE, metalness: 0.4, roughness: 0.4 });
  const orange = new MeshStandardMaterial({
    color: ORANGE,
    emissive: ORANGE,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const glass = new MeshStandardMaterial({
    color: 0x0b1b3a,
    metalness: 0.9,
    roughness: 0.08,
    emissive: 0x0a3a7a,
    emissiveIntensity: 0.55,
  });
  const dark = new MeshStandardMaterial({ color: 0x0a0f1c, roughness: 0.8 });

  const add = (geo, mat, x, y, z) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    bus.add(m);
    return m;
  };

  add(new BoxGeometry(2.2, 1.5, 6.2), paint, 0, 1.25, 0); // body
  add(new BoxGeometry(2.0, 0.55, 5.6), paint, 0, 2.25, -0.1); // roof hump
  add(new BoxGeometry(2.24, 0.32, 6.24), blue, 0, 0.82, 0); // lower stripe
  add(new BoxGeometry(2.26, 0.1, 6.26), orange, 0, 1.02, 0); // accent line
  add(new BoxGeometry(2.24, 0.72, 5.1), glass, 0, 1.62, -0.25); // side windows
  add(new BoxGeometry(1.9, 0.78, 0.06), glass, 0, 1.68, 3.12); // windscreen
  add(new BoxGeometry(2.1, 0.22, 0.14), dark, 0, 0.62, 3.14); // bumper
  add(new BoxGeometry(2.1, 0.22, 0.14), dark, 0, 0.62, -3.14);
  add(new BoxGeometry(1.2, 0.14, 0.06), orange, 0, 2.16, 3.1); // destination sign

  const lamp = new MeshStandardMaterial({
    color: 0xfff3c4,
    emissive: 0xffe9a8,
    emissiveIntensity: 2.2,
  });
  const tail = new MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff3b30,
    emissiveIntensity: 1.8,
  });
  for (const x of [-0.8, 0.8]) {
    add(new BoxGeometry(0.34, 0.16, 0.06), lamp, x, 0.98, 3.13);
    add(new BoxGeometry(0.34, 0.16, 0.06), tail, x, 0.98, -3.13);
  }

  const wheelGeo = new CylinderGeometry(0.52, 0.52, 0.36, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new CylinderGeometry(0.26, 0.26, 0.4, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const z of [-2.1, 2.1]) {
    for (const x of [-1.1, 1.1]) {
      const g = new Group();
      g.add(new Mesh(wheelGeo, dark));
      g.add(new Mesh(hubGeo, blue));
      g.position.set(x, 0.52, z);
      bus.add(g);
      wheels.push(g);
    }
  }
  bus.userData.wheels = wheels;

  // Glow under the coach, so it sits in the scene rather than floating.
  const glow = new Mesh(
    new RingGeometry(1.2, 4.2, 40),
    new MeshBasicMaterial({
      color: BLUE,
      transparent: true,
      opacity: 0.16,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  bus.add(glow);
  return bus;
}

export function initScene(canvas, { reduced = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(NAVY, 0);

  const scene = new Scene();
  scene.fog = new FogExp2(0x07142e, 0.0065);
  const camera = new PerspectiveCamera(48, 1, 0.1, 400);

  // Lights
  scene.add(new AmbientLight(0x9db6ee, 1.6));
  scene.add(new HemisphereLight(0x9cc4ff, 0x1a2a5a, 1.4));
  const sun = new DirectionalLight(0xeaf2ff, 3.2);
  sun.position.set(12, 22, 8);
  scene.add(sun);
  const rim = new DirectionalLight(0x8fb8ff, 1.8);
  rim.position.set(-14, 10, -6);
  scene.add(rim);
  const fillBlue = new PointLight(BLUE, 90, 40, 1.6);
  const fillOrange = new PointLight(ORANGE, 60, 34, 1.7);
  scene.add(fillBlue, fillOrange);

  // The route: a winding road through the "country".
  const pts = [];
  for (let i = 0; i < 11; i += 1) {
    pts.push(new Vector3(Math.sin(i * 0.95) * 16, 0, -i * 26));
  }
  const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const SAMPLES = 520;
  const up = new Vector3(0, 1, 0);

  // Road ribbon
  {
    const pos = new Float32Array(SAMPLES * 2 * 3);
    const idx = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i / (SAMPLES - 1);
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new Vector3().crossVectors(tan, up).normalize().multiplyScalar(2.5);
      pos.set([p.x - side.x, 0.01, p.z - side.z, p.x + side.x, 0.01, p.z + side.z], i * 6);
      if (i < SAMPLES - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    scene.add(
      new Mesh(
        g,
        new MeshStandardMaterial({
          color: 0x0e1b38,
          roughness: 0.85,
          metalness: 0.05,
          emissive: 0x06112a,
          emissiveIntensity: 0.5,
          side: DoubleSide,
        }),
      ),
    );
    // glowing centre line
    const line = new Mesh(
      new TubeGeometry(curve, 400, 0.09, 6, false),
      new MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.9 }),
    );
    line.position.y = 0.06;
    scene.add(line);
  }

  // Ground grid
  const grid = new GridHelper(900, 150, 0x2a68c8, 0x15376f);
  grid.position.set(0, -0.02, -130);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);

  // Cities along the route
  const stops = [];
  const nodeMat = new MeshStandardMaterial({
    color: ORANGE,
    emissive: ORANGE,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const beamMat = new MeshBasicMaterial({
    color: ORANGE,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const ringMat = new MeshBasicMaterial({
    color: ORANGE,
    transparent: true,
    opacity: 0.5,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (let k = 1; k <= 8; k += 1) {
    const t = k / 9;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new Vector3().crossVectors(tan, up).normalize();
    const g = new Group();
    g.position.copy(p).addScaledVector(side, k % 2 ? 10 : -10);
    const gem = new Mesh(new OctahedronGeometry(0.6, 0), nodeMat);
    gem.position.y = 3;
    g.add(gem);
    const beam = new Mesh(new CylinderGeometry(0.06, 0.5, 6, 12, 1, true), beamMat);
    beam.position.y = 3;
    g.add(beam);
    const ring = new Mesh(new RingGeometry(1.2, 1.5, 40), ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    // a few "buildings"
    for (let b = 0; b < 4; b += 1) {
      const h = 1 + ((k * 7 + b * 3) % 5) * 0.7;
      const box = new Mesh(
        new BoxGeometry(1, h, 1),
        new MeshStandardMaterial({
          color: 0x10244d,
          roughness: 0.6,
          emissive: 0x0a2a66,
          emissiveIntensity: 0.4,
        }),
      );
      box.position.set(((b % 2) * 2 - 1) * 1.8 + (b > 1 ? 0.6 : 0), h / 2, (b > 1 ? 1 : -1) * 1.8);
      g.add(box);
    }
    scene.add(g);
    stops.push({ g, gem, ring });
  }

  // Floating particles
  {
    const n = 700;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const t = Math.random();
      const p = curve.getPointAt(t);
      arr[i * 3] = p.x + (Math.random() - 0.5) * 90;
      arr[i * 3 + 1] = Math.random() * 28;
      arr[i * 3 + 2] = p.z + (Math.random() - 0.5) * 40;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(arr, 3));
    scene.add(
      new Points(
        g,
        new PointsMaterial({
          color: 0x8fc2ff,
          size: 0.14,
          transparent: true,
          opacity: 0.7,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
  }

  // A glowing sphere far ahead, as a destination
  const sun2 = new Mesh(
    new SphereGeometry(7, 24, 24),
    new MeshBasicMaterial({ color: new Color(ORANGE), transparent: true, opacity: 0.18 }),
  );
  const endP = curve.getPointAt(1);
  sun2.position.set(endP.x, 18, endP.z - 60);
  scene.add(sun2);

  const coach = buildCoach();
  scene.add(coach);

  // ---- State ---------------------------------------------------------------------------------
  let target = 0;
  let current = 0;
  let prevT = 0;
  let wheelSpin = 0;
  let pointerX = 0;
  let pointerY = 0;
  let raf = 0;
  let running = false;
  const tmpPos = new Vector3();
  const tmpTan = new Vector3();
  const tmpSide = new Vector3();
  const camPos = new Vector3();
  const look = new Vector3();
  const orbit = new Vector3();
  const camRight = new Vector3();
  const startTime = performance.now();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    const time = (now - startTime) / 1000;
    current += (target - current) * (reduced ? 1 : 0.06);
    const t = clamp(0.012 + current * 0.95, 0, 0.995);

    curve.getPointAt(t, tmpPos);
    curve.getTangentAt(t, tmpTan).normalize();
    tmpSide.crossVectors(tmpTan, up).normalize();

    coach.position.copy(tmpPos);
    coach.position.y = 0.02;
    coach.lookAt(tmpPos.x + tmpTan.x, 0.02, tmpPos.z + tmpTan.z);
    coach.rotation.z = Math.sin(time * 1.6) * 0.006;

    wheelSpin += (t - prevT) * 900;
    prevT = t;
    for (const w of coach.userData.wheels) w.rotation.x = wheelSpin;

    const wide = camera.aspect > 1.15;
    const hero = 1 - smooth(0, 0.07, current);

    // Follow camera: behind, above and to the side of the coach.
    camPos
      .copy(tmpPos)
      .addScaledVector(tmpTan, -11)
      .addScaledVector(tmpSide, -2.2)
      .addScaledVector(up, 3.6);
    // Showcase camera: a three-quarter view in front of the coach that sways slowly.
    const radius = wide ? 13.5 : 20;
    const ang = 0.95 + Math.sin(time * 0.3) * 0.32;
    orbit
      .copy(tmpPos)
      .addScaledVector(tmpTan, Math.cos(ang) * radius)
      .addScaledVector(tmpSide, -Math.sin(ang) * radius);
    orbit.y = 4.2 + Math.sin(time * 0.4) * 0.3;
    camPos.lerp(orbit, hero);
    camPos.x += pointerX * 1.2;
    camPos.y += -pointerY * 0.6;
    camera.position.copy(camPos);

    look.copy(tmpPos).addScaledVector(tmpTan, 4.5 * (1 - hero));
    look.y = 0.4 + (1 - hero) * 1.0 + (wide ? 0 : 2.4 * hero);
    if (wide) {
      // Slide the view so the coach sits on the right, beside the words.
      camRight.subVectors(look, camPos).normalize();
      camRight.crossVectors(camRight, up).normalize();
      look.addScaledVector(camRight, -3.8);
    }
    camera.lookAt(look);

    fillBlue.position.copy(tmpPos).addScaledVector(tmpSide, 6).addScaledVector(up, 6);
    fillOrange.position
      .copy(tmpPos)
      .addScaledVector(tmpSide, -7)
      .addScaledVector(tmpTan, 6)
      .addScaledVector(up, 4);

    for (const [i, s] of stops.entries()) {
      s.gem.rotation.y = time * 0.9 + i;
      s.gem.position.y = 3 + Math.sin(time * 1.4 + i) * 0.35;
      const k = (time * 0.6 + i * 0.3) % 1;
      s.ring.scale.setScalar(1 + k * 2.2);
      s.ring.material.opacity = 0.5 * (1 - k);
    }
    sun2.scale.setScalar(1 + Math.sin(time * 0.7) * 0.04);

    renderer.render(scene, camera);
  }

  function loop(now) {
    frame(now);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener('resize', () => {
    resize();
    if (reduced) frame(performance.now());
  });
  window.addEventListener('pointermove', (e) => {
    pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
    pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  resize();
  frame(performance.now());
  start();

  return {
    setProgress(p) {
      target = clamp(p);
      if (reduced) frame(performance.now());
    },
  };
}
