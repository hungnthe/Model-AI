import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 32;
  controls.maxPolarAngle = Math.PI / 2.05;
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(4, 8, 6);
  scene.add(light, new THREE.AmbientLight(0xd1e4e1, 1.6));
  const root = new THREE.Group();
  scene.add(root);
  const colors = { normal: 0xa2e4b9, anomaly: 0xf08a9d, cut: 0xe0ca84 };
  let focus = 0;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let records = [];
  let loadedCount = 0;

  function label(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.font = '500 36px Segoe UI';
    context.fillStyle = '#cadad4';
    context.textAlign = 'center';
    context.fillText(text, 256, 61);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.scale.set(2.45, 0.48, 1);
    return sprite;
  }
  const stageLabels = ['JSON input', 'Random cut forest', 'Mean CoDisp', 'JSON result'];
  const stages = stageLabels.map((text, index) => {
    const group = new THREE.Group();
    group.position.x = -4.8 + index * 3.2;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.35, .09, 2.05), new THREE.MeshStandardMaterial({
      color: [0x234b3a, 0x2e415c, 0x56313c, 0x534d2e][index], roughness: .8,
    }));
    group.add(plate);
    const title = label(text);
    title.position.set(0, -.25, 1.5);
    group.add(title);
    root.add(group);
    return group;
  });

  const treeGroup = new THREE.Group();
  treeGroup.position.set(-1.6, .1, 0);
  root.add(treeGroup);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8bb5e0, transparent: true, opacity: .7 });
  const nodeGeometry = new THREE.SphereGeometry(.035, 8, 8);
  const nodeMaterial = new THREE.MeshStandardMaterial({ color: 0xc0daf4 });
  for (let tree = 0; tree < 7; tree += 1) {
    const x = (tree % 3 - 1) * .65;
    const z = (Math.floor(tree / 3) - 1) * .65;
    const positions = [[x, 1.85, z], [x - .23, 1.3, z], [x + .23, 1.3, z],
      [x - .38, .65, z], [x - .08, .65, z], [x + .08, .65, z], [x + .38, .65, z]];
    for (let index = 1; index < positions.length; index += 1) {
      const parent = Math.floor((index - 1) / 2);
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...positions[parent]), new THREE.Vector3(...positions[index])]);
      treeGroup.add(new THREE.Line(geometry, lineMaterial));
    }
    positions.forEach((position) => {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.set(...position);
      treeGroup.add(node);
    });
  }
  const cutPlanes = [];
  for (let index = 0; index < 3; index += 1) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.8), new THREE.MeshBasicMaterial({
      color: colors.cut, transparent: true, opacity: .1, side: THREE.DoubleSide, depthWrite: false,
    }));
    plane.position.set(-1.6 + index * .25, 1, (index - 1) * .4);
    plane.rotation.y = index * Math.PI / 2;
    root.add(plane);
    cutPlanes.push(plane);
  }
  const input = new THREE.Mesh(new THREE.BoxGeometry(.75, 1, .18), new THREE.MeshStandardMaterial({ color: 0x87c9ab }));
  input.position.set(-4.8, .75, 0);
  root.add(input);
  const output = new THREE.Mesh(new THREE.BoxGeometry(.75, 1, .18), new THREE.MeshStandardMaterial({ color: 0xe0ca84 }));
  output.position.set(4.8, .75, 0);
  root.add(output);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.64, .045, 12, 64), new THREE.MeshStandardMaterial({
    color: colors.anomaly, emissive: colors.anomaly, emissiveIntensity: .22,
  }));
  ring.position.set(1.6, .9, 0);
  root.add(ring);

  for (let index = 0; index < 3; index += 1) {
    const from = new THREE.Vector3(-3.55 + index * 3.2, .25, 0);
    const to = new THREE.Vector3(-2.95 + index * 3.2, .25, 0);
    root.add(new THREE.ArrowHelper(to.clone().sub(from).normalize(), from, .6, 0x769183, .13, .1));
  }
  const pointGeometry = new THREE.SphereGeometry(.065, 12, 12);
  const particles = Array.from({ length: 50 }, (_, index) => {
    const particle = new THREE.Mesh(pointGeometry, new THREE.MeshStandardMaterial({ color: colors.normal }));
    particle.userData.offset = index * .23;
    root.add(particle);
    return particle;
  });
  function refreshParticles() {
    particles.forEach((particle, index) => {
      const record = records[index % (records.length || 1)];
      particle.visible = loadedCount > 0 && index < Math.min(50, loadedCount);
      particle.userData.anomaly = Boolean(record?.isAnomaly);
      particle.material.color.setHex(record?.isAnomaly ? colors.anomaly : colors.normal);
      particle.scale.setScalar(record?.isAnomaly ? 1.8 : 1);
    });
  }
  function reset() {
    const aspect = Math.max(host.clientWidth / host.clientHeight, .5);
    const distance = Math.max(6.8, 16.8 / aspect);
    camera.position.set(1, distance * .62, distance);
    controls.target.set(0, .65, 0);
    camera.lookAt(controls.target);
    controls.update();
  }
  function resize() {
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    reset();
  }
  new ResizeObserver(resize).observe(host);
  const clock = new THREE.Clock();
  let elapsed = 0;
  function animate() {
    const delta = Math.min(clock.getDelta(), .05);
    if (!paused) elapsed += delta;
    particles.forEach((particle) => {
      const progress = ((elapsed * .75 + particle.userData.offset) % 11.6) / 11.6;
      particle.position.set(-5.8 + progress * 11.6,
        .55 + Math.sin(elapsed * 1.3 + particle.userData.offset) * .25 + (particle.userData.anomaly ? .75 : 0),
        Math.cos(particle.userData.offset * 2.4) * .45);
    });
    cutPlanes.forEach((plane) => { plane.material.opacity = focus === 1 ? .27 : .08; });
    ring.rotation.y = Math.sin(elapsed * .6) * .4;
    stages.forEach((stage, index) => { stage.children[0].material.emissive.setHex(index === focus ? 0x18231d : 0x000000); });
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  resize();
  refreshParticles();
  animate();
  return {
    setMode(mode) { focus = ['stream', 'cut', 'score', 'deploy'].indexOf(mode); },
    setData(count, results = []) { loadedCount = count; records = results; refreshParticles(); },
    togglePause() { paused = !paused; return paused; },
    reset,
    get paused() { return paused; },
  };
}
