// viewer.js - three.js based GLB viewer for Kjellberg textured model
// Loads kjellberg-3d-textured_model.glb from project root and provides orbit controls + reset view.

/* Using global THREE, OrbitControls and GLTFLoader loaded via UMD scripts in 3d-viewer.html */

const GLB_PATH = 'kjellberg-3d-textured_model.glb';
const container = document.getElementById('viewer');
const loadingEl = document.getElementById('loading');

let camera, scene, renderer, controls;
let modelGroup = new THREE.Group();
let initialCameraState = null;

init();
animate();

function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  // r150+ removed outputEncoding in favor of outputColorSpace.
  if ('outputColorSpace' in renderer) {
    if (typeof THREE !== 'undefined' && 'SRGBColorSpace' in THREE) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      // best-effort fallback; some builds still accept the string
      try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch(e) {}
    }
  } else if ('outputEncoding' in renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  container.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  // Camera (fov, aspect, near, far) - will be positioned after model loads
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
  camera.position.set(0, 5, 10);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(-5, 10, 7);
  dir.castShadow = false;
  scene.add(dir);

  // Add group for model
  scene.add(modelGroup);

  // Controls - be resilient to different three.js builds / attachment locations
  const OrbitControlsClass =
    (typeof window !== 'undefined' && window.OrbitControls) ||
    (typeof THREE !== 'undefined' && (THREE.OrbitControls || THREE['controls']?.OrbitControls));
  if (!OrbitControlsClass) {
    showError('OrbitControls not available in this build of three.js.');
    return;
  }
  controls = new OrbitControlsClass(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.target.set(0, 0, 0);

  // Load the converted GLB model
  loadGLBModel();

  // Events
  window.addEventListener('resize', onWindowResize, false);
  const resetBtn = document.getElementById('reset-view');
  if (resetBtn) resetBtn.addEventListener('click', (e) => { e.preventDefault(); resetView(); });
}

function loadGLBModel() {
  const GLTFLoaderClass =
    (typeof window !== 'undefined' && window.GLTFLoader) ||
    (typeof THREE !== 'undefined' && THREE.GLTFLoader);
  if (!GLTFLoaderClass) {
    showError('GLTFLoader not available in this build of three.js.');
    return;
  }
  const loader = new GLTFLoaderClass();

  // Check for DRACOLoader (required for compressed meshes)
  const DRACOLoaderClass =
    (typeof window !== 'undefined' && window.DRACOLoader) ||
    (typeof THREE !== 'undefined' && (THREE.DRACOLoader || THREE['addons']?.DRACOLoader));
  
  if (DRACOLoaderClass) {
    const dracoLoader = new DRACOLoaderClass();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
  } else {
    console.warn('DRACOLoader not available - Draco compressed meshes may not load properly');
  }

  loader.load(
    GLB_PATH,
    (gltf) => {
      // Clear previous
      modelGroup.clear();

      const model = gltf.scene || gltf.scenes?.[0];
      if (!model) {
        showError('Loaded file contains no scene.');
        return;
      }

      // Add model to group
      modelGroup.add(model);

      // Ensure correct encoding for textures if present
      model.traverse((n) => {
        if (n.isMesh && n.material) {
          if (Array.isArray(n.material)) {
            n.material.forEach(m => adjustMaterial(m));
          } else {
            adjustMaterial(n.material);
          }
        }
      });

      // Compute bounding box and frame the camera
      frameModel(modelGroup);

      // Hide loading
      if (loadingEl) loadingEl.style.display = 'none';
    },
    (xhr) => {
      // progress
      if (loadingEl) {
        const p = xhr.total ? (xhr.loaded / xhr.total) * 100 : null;
        loadingEl.textContent = p ? `Loading 3D model... ${p.toFixed(0)}%` : 'Loading 3D model...';
      }
    },
    (err) => {
      console.error('GLTF load error:', err);
      showError('Failed to load 3D model. See console for details.');
    }
  );
}

function adjustMaterial(mat) {
  // Make sure color space is correct
  if (mat.map) {
    if ('colorSpace' in mat.map) {
      // r150+ uses colorSpace
      try { mat.map.colorSpace = THREE.SRGBColorSpace; } catch (e) { /* ignore */ }
    } else if ('encoding' in mat.map) {
      mat.map.encoding = THREE.sRGBEncoding;
    }
    mat.map.flipY = false; // GLB textures usually correct orientation
  }
  if (mat.emissiveMap) {
    if ('colorSpace' in mat.emissiveMap) {
      try { mat.emissiveMap.colorSpace = THREE.SRGBColorSpace; } catch (e) {}
    } else if ('encoding' in mat.emissiveMap) {
      mat.emissiveMap.encoding = THREE.SRGBEncoding;
    }
  }
  if (mat.lightMap) {
    if ('colorSpace' in mat.lightMap) {
      try { mat.lightMap.colorSpace = THREE.SRGBColorSpace; } catch (e) {}
    } else if ('encoding' in mat.lightMap) {
      mat.lightMap.encoding = THREE.SRGBEncoding;
    }
  }
  // enable shadows if desired (depends on model)
  mat.needsUpdate = true;
}

function frameModel(object) {
  // Compute bounding box of object
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // If size is zero, fallback
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  // add some offset
  distance = distance * 1.5 + 0.5;

  // New camera position along Z axis from center
  const camPos = new THREE.Vector3(center.x, center.y, center.z + distance);
  camera.position.copy(camPos);
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  // Set controls target and update
  controls.target.copy(center);
  controls.update();

  // Save initial camera state for reset
  initialCameraState = {
    position: camera.position.clone(),
    target: controls.target.clone()
  };
}

function resetView() {
  if (!initialCameraState) return;
  camera.position.copy(initialCameraState.position);
  controls.target.copy(initialCameraState.target);
  controls.update();
}

function onWindowResize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function showError(msg) {
  console.error(msg);
  if (loadingEl) {
    loadingEl.textContent = msg;
    loadingEl.style.display = 'block';
    loadingEl.style.background = 'rgba(128,0,0,0.8)';
  } else {
    alert(msg);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}
