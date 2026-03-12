import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const container = document.getElementById("viewer3d");

// scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6f3ee);

// camera
const camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  1000
);

camera.position.set(6,4,6);

// renderer
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

// orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// lighting
const light1 = new THREE.AmbientLight(0xffffff,1.6);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xffffff,2);
light2.position.set(10,10,5);
scene.add(light2);

// floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(50,50),
  new THREE.MeshStandardMaterial({color:0xeae6df})
);

floor.rotation.x = -Math.PI/2;
scene.add(floor);

// model loader
const loader = new GLTFLoader();

loader.load(
  "https://sonasystemsprototyping.s3.us-east-1.amazonaws.com/sona.glb",   // put your model here
  function(gltf){

    const model = gltf.scene;
    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());

    model.position.sub(center);

  },
  undefined,
  function(error){
    console.log(error);
  }
);

// resize
window.addEventListener("resize", () => {

  camera.aspect = container.clientWidth/container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth,container.clientHeight);

});

// animation
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene,camera);
}

animate();