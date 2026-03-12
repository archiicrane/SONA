loader.load(
  "https://sonasystemsprototyping.s3.us-east-1.amazonaws.com/sona.glb",
  (gltf) => {
    const model = gltf.scene;
    scene.add(model);
  },
  undefined,
  (error) => {
    console.error("Model failed to load:", error);
  }
);
console.log('TEST CHANGE')
