/* Trimwerk – 3D-Vorschau für STL-Dateien (three.js, selbst gehostet) */
import * as THREE from '../lib/three/three.module.min.js';
import { STLLoader } from '../lib/three/STLLoader.js';
import { OrbitControls } from '../lib/three/OrbitControls.js';


/**
 * Zeigt STL-Dateien in einem Element an.
 * parts: [{ buffer: ArrayBuffer, name }]
 * opts: { background, grid, autoRotate, preserve (für Screenshots) }
 * Rückgabe: { dispose(), reset(), toggleRotate(), canvas }
 */
export function createViewer(el, parts, opts = {}) {
  const w = () => Math.max(1, el.clientWidth), h = () => Math.max(1, el.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !opts.background, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w(), h());
  if (opts.background) renderer.setClearColor(opts.background, 1);
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, w() / h(), 0.1, 5000);
  camera.up.set(0, 0, 1);                       // Druckbett: Z nach oben

  scene.add(new THREE.HemisphereLight(0xdfe8ef, 0x1a222a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-1, -1.4, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc7ff, 0.9); rim.position.set(1.5, 1.2, 0.6); scene.add(rim);

  const loader = new STLLoader();
  const group = new THREE.Group();
  // Größtes Teil grau, kleinere Teile in Trimwerk-Orange (dann Blau, Grün …)
  const geos = parts.map(p => { const g = loader.parse(p.buffer); g.computeVertexNormals(); g.computeBoundingBox(); return g; });
  const vol = g => { const s = g.boundingBox.getSize(new THREE.Vector3()); return s.x * s.y * s.z; };
  const big = geos.length > 1 ? geos.indexOf(geos.reduce((m, g) => vol(g) > vol(m) ? g : m)) : -1;
  let k = 0;
  parts.forEach((p, i) => {
    const geo = geos[i];
    const color = i === big ? 0x9aa5ae : [0xff7a2e, 0x5aa7e8, 0x3cc487, 0xe3b13c][k++ % 4];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, flatShading: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = p.name || 'Teil ' + (i + 1);
    group.add(mesh);
    // Kanten nachzeichnen: Gravuren, Fasen und Schriftzüge werden so gut sichtbar
    if (opts.edges !== false) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28),
        new THREE.LineBasicMaterial({ color: 0x1a1208, transparent: true, opacity: 0.38 }));
      group.add(edges);
    }
  });
  scene.add(group);

  // Auf das Bett stellen und zentrieren
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  group.position.set(-c.x, -c.y, -box.min.z);
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 10;

  if (opts.grid !== false) {
    const g = Math.ceil(r * 1.6 / 10) * 10;
    const grid = new THREE.GridHelper(g, g / 10, 0x3a4b59, 0x24333f);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.01;
    scene.add(grid);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, size.z / 2);
  controls.autoRotate = !!opts.autoRotate;
  controls.autoRotateSpeed = 1.2;

  // Blickrichtung: von der Seite mit den meisten Details (z. B. Gravur), damit man sie sofort sieht
  const side = { x: 1, y: 1 };
  if (opts.autoSide !== false) {
    const cnt = { px: 0, nx: 0, py: 0, ny: 0 };
    const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    geos.forEach(g => {
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k += 3) {
        a.fromBufferAttribute(pos, k); b.fromBufferAttribute(pos, k + 1); c.fromBufferAttribute(pos, k + 2);
        n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
        if (n.x > 0.5) cnt.px++; else if (n.x < -0.5) cnt.nx++;
        if (n.y > 0.5) cnt.py++; else if (n.y < -0.5) cnt.ny++;
      }
    });
    if (cnt.py > cnt.ny * 1.5 + 20) side.y = -1;   // Standardblick kommt von −y; Details auf +y → umdrehen
    if (cnt.px > cnt.nx * 1.5 + 20) side.x = -1;
  }
  function reset() {
    const d = r * 2.1;
    const v0 = (opts.view || new THREE.Vector3(-0.9, -1.3, 0.85)).clone();
    v0.x *= side.x; v0.y *= side.y;
    const dir = v0.normalize();
    camera.position.set(dir.x * d, dir.y * d, size.z / 2 + dir.z * d);
    controls.target.set(0, 0, size.z / 2);
    controls.update();
  }
  reset();

  let raf = 0, alive = true;
  const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();

  const ro = new ResizeObserver(() => { camera.aspect = w() / h(); camera.updateProjectionMatrix(); renderer.setSize(w(), h()); });
  ro.observe(el);

  return {
    canvas: renderer.domElement,
    size: { x: size.x, y: size.y, z: size.z },
    reset,
    toggleRotate() { controls.autoRotate = !controls.autoRotate; return controls.autoRotate; },
    setView(v) { opts.view = new THREE.Vector3(v[0], v[1], v[2]); reset(); },
    render() { controls.update(); renderer.render(scene, camera); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose(); renderer.domElement.remove();
    }
  };
}
