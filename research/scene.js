import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

export function createScene(container, data = null, hero = false, onAtom = () => {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    container.innerHTML = '<div class="webgl-error">当前浏览器无法启用 WebGL。请开启硬件加速；结构参数和预测仍可使用。</div>';
    return { dispose() {}, reset() {}, toggleCell() {}, toggleSpin() {}, toggleStyle() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = hero && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotateSpeed = hero ? .45 : .8;
  controls.enablePan = !hero;
  scene.add(new THREE.AmbientLight(0xa7c6ec, 2));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(10, 20, 15);
  scene.add(key);
  const rim = new THREE.PointLight(0x51f1c5, 160);
  rim.position.set(-10, -3, 8);
  scene.add(rim);
  const group = new THREE.Group();
  scene.add(group);
  const objects = [], dummy = new THREE.Object3D();
  let spheres, bondsMesh, cells, originalScales = [];
  if (hero) {
    const atoms = [], bonds = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      atoms.push({ position: [x * 3.3, y * 3.3, z * 3.3], color: (x + y + z) % 2 ? '#66e7c1' : '#bcd4df', element: 'node' });
    }
    for (let i = 0; i < 27; i++) for (let j = i + 1; j < 27; j++) {
      const a = new THREE.Vector3(...atoms[i].position), b = new THREE.Vector3(...atoms[j].position);
      if (Math.abs(a.distanceTo(b) - 3.3) < .01) {
        const first = atoms.length;
        for (const t of [.3, .5, .7]) atoms.push({ position: a.clone().lerp(b, t).toArray(), color: '#668397', element: 'link' });
        bonds.push([i, first], [first, first + 1], [first + 1, first + 2], [first + 2, j]);
      }
    }
    data = { atoms, bonds };
    group.rotation.set(.3, .35, .2);
  }
  if (data) {
    const geo = new THREE.SphereGeometry(1, hero ? 20 : 14, hero ? 16 : 10);
    const mat = new THREE.MeshStandardMaterial({ roughness: .24, metalness: .4 });
    spheres = new THREE.InstancedMesh(geo, mat, data.atoms.length);
    data.atoms.forEach((atom, i) => {
      const scale = hero ? (atom.element === 'node' ? .36 : .12) : (['C', 'H', 'O', 'N'].includes(atom.element) ? .24 : .43);
      originalScales.push(scale);
      dummy.position.set(...atom.position);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      spheres.setMatrixAt(i, dummy.matrix);
      spheres.setColorAt(i, new THREE.Color(atom.color));
    });
    group.add(spheres);
    const bondGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    bondsMesh = new THREE.InstancedMesh(bondGeo, new THREE.MeshStandardMaterial({ color: hero ? '#527d85' : '#5b7284', roughness: .45, metalness: .2 }), data.bonds.length);
    data.bonds.forEach(([i, j], idx) => {
      const a = new THREE.Vector3(...data.atoms[i].position), b = new THREE.Vector3(...data.atoms[j].position);
      dummy.position.copy(a).add(b).multiplyScalar(.5);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      dummy.scale.set(hero ? .055 : .075, a.distanceTo(b), hero ? .055 : .075);
      dummy.updateMatrix();
      bondsMesh.setMatrixAt(idx, dummy.matrix);
    });
    group.add(bondsMesh);
    if (data.lattice) {
      const points = [];
      const verts = [];
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3();
        data.lattice.forEach((row, bit) => { if (i & (1 << bit)) v.add(new THREE.Vector3(...row)); });
        verts.push(v);
      }
      for (let i = 0; i < 8; i++) for (let bit = 0; bit < 3; bit++) {
        const j = i ^ (1 << bit);
        if (j > i) points.push(verts[i], verts[j]);
      }
      cells = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#62cbb9', transparent: true, opacity: .45 }));
      group.add(cells);
    }
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const size = bounds.getSize(new THREE.Vector3()).length();
    const distance = Math.max(size * 1.15, 14);
    const reset = () => {
      camera.position.set(distance * .64, distance * .38, distance * .85);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    objects.push(reset);
    reset();
    controls.minDistance = size * .18;
    controls.maxDistance = size * 4;
  }
  if (hero) {
    const starGeo = new THREE.BufferGeometry();
    const positions = [];
    let seed = 732;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 180; i++) positions.push((rand() - .5) * 45, (rand() - .5) * 35, (rand() - .5) * 30);
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#9ce7dd', size: .035, transparent: true, opacity: .7 })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.7, .015, 8, 160), new THREE.MeshBasicMaterial({ color: '#3e776e', transparent: true, opacity: .6 }));
    ring.rotation.set(Math.PI / 2.8, .2, 0);
    scene.add(ring);
  }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const pick = e => {
    if (hero || !spheres) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(spheres)[0];
    if (hit) onAtom(data.atoms[hit.instanceId], hit.instanceId);
  };
  renderer.domElement.addEventListener('click', pick);
  const resize = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (w && h) {
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  });
  resize.observe(container);
  let frame, filled = false, disposed = false;
  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (!document.hidden) { controls.update(); renderer.render(scene, camera); }
  };
  animate();
  return {
    reset: () => objects[0]?.(),
    toggleCell: () => { if (cells) cells.visible = !cells.visible; },
    toggleSpin: () => { controls.autoRotate = !controls.autoRotate; },
    toggleStyle: () => {
      filled = !filled;
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      data.atoms.forEach((a, i) => {
        spheres.getMatrixAt(i, matrix);
        matrix.decompose(p, q, s);
        matrix.compose(p, q, s.setScalar(originalScales[i] * (filled ? 2.6 : 1)));
        spheres.setMatrixAt(i, matrix);
      });
      spheres.instanceMatrix.needsUpdate = true;
      bondsMesh.visible = !filled;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('click', pick);
      scene.traverse(obj => { obj.geometry?.dispose(); if (obj.material) obj.material.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
