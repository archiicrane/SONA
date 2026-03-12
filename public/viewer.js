import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

console.log("viewer.js loaded");

const container = document.getElementById("viewer3d");

if (!container) {
  console.error("viewer3d container not found");
} else {
  container.innerHTML = "";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06134a);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    5000
  );
  camera.position.set(8, 6, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 2);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 2);
  dir.position.set(10, 10, 10);
  scene.add(dir);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x0b1d63, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);

  const loader = new GLTFLoader();

  loader.load(
    "https://sonasystemsprototyping.s3.us-east-1.amazonaws.com/sona.glb",
    (gltf) => {
      console.log("model loaded");

      const model = gltf.scene;
      scene.add(model);

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      model.position.sub(center);

      const newBox = new THREE.Box3().setFromObject(model);
      model.position.y -= newBox.min.y;

      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
      controls.target.set(0, maxDim * 0.4, 0);
      controls.update();
    },
    (xhr) => {
      if (xhr.total) {
        console.log(`loading: ${Math.round((xhr.loaded / xhr.total) * 100)}%`);
      }
    },
    (error) => {
      console.error("Model failed to load:", error);
    }
  );

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}
