// ============================================================
// viewer3d.js — LibraTronic · Visualizador 3D do Modelo do Projeto
// Carrega o modelo FBX real da prótese (hand_model.fbx) via Three.js
// e exibe um visualizador interativo com órbita, zoom e auto-rotação.
// ============================================================

'use strict';

class Viewer3DModelo {
  constructor(containerId) {
    this.containerId = containerId;
    this.container   = null;
    this.renderer    = null;
    this.scene       = null;
    this.camera      = null;
    this.model       = null;
    this.mixer       = null;
    this.clock       = new THREE.Clock();
    this.rafId       = null;

    // Controles de órbita internos (sem dependência externa)
    this.autoRotando = true;
    this.arrastando  = false;
    this.lastPointer = { x: 0, y: 0 };
    this.orbitaTheta = 0;       // ângulo horizontal
    this.orbitaPhi   = 0.3;     // ângulo vertical (radianos)
    this.orbitaRaio  = 350;     // distância da câmera (ajustado ao modelo FBX)
    this._lastW      = 0;
    this._lastH      = 0;

    this._handlers   = {};
  }

  // ----------------------------------------------------------
  // init() — inicializa a cena, câmera, luzes e carrega o FBX
  // ----------------------------------------------------------
  init() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) return;

    // ── RENDERER ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding    = THREE.sRGBEncoding;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const w = this.container.clientWidth  || 680;
    const h = this.container.clientHeight || 480;
    this.renderer.setSize(w, h, false);
    this.container.appendChild(this.renderer.domElement);
    this._lastW = w;
    this._lastH = h;

    // ── CENA ──
    this.scene = new THREE.Scene();
    this.scene.background = null; // transparente (herda CSS)

    // ── CÂMERA ──
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 10000);
    this._atualizarPosicaoCamera();

    // ── ILUMINAÇÃO ESTÚDIO ──
    // Ambiente suave difuso
    const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambLight);

    // Luz principal frontal-superior (key light)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(150, 300, 200);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far  = 2000;
    keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -300;
    keyLight.shadow.camera.right = keyLight.shadow.camera.top  =  300;
    this.scene.add(keyLight);

    // Rim light (contra-luz lateral fria)
    const rimLight = new THREE.DirectionalLight(0xb0d4f1, 0.55);
    rimLight.position.set(-200, 100, -150);
    this.scene.add(rimLight);

    // Fill light suave de baixo
    const fillLight = new THREE.DirectionalLight(0xffeedd, 0.3);
    fillLight.position.set(0, -200, 100);
    this.scene.add(fillLight);

    // ── CARREGAMENTO DO MODELO FBX ──
    this._carregarFBX();

    // ── CONTROLES DE INTERAÇÃO ──
    this._configurarControles();

    // ── RESIZE ──
    this._handlers.resize = () => this._resize();
    window.addEventListener('resize', this._handlers.resize);

    // ── ResizeObserver para mudanças de layout ──
    if (window.ResizeObserver) {
      this._resizeObs = new ResizeObserver(() => this._resize());
      this._resizeObs.observe(this.container);
    }

    // ── LOOP DE RENDERIZAÇÃO ──
    this._loop();
  }

  // ----------------------------------------------------------
  // _carregarFBX() — usa FBXLoader via CDN
  // ----------------------------------------------------------
  _carregarFBX() {
    // Garante que o FBXLoader está disponível
    if (typeof THREE.FBXLoader === 'undefined') {
      console.warn('[Viewer3D] FBXLoader não encontrado. Carregando via CDN...');
      return;
    }

    const loader  = new THREE.FBXLoader();
    const spinner = document.getElementById('home-hand3d-loading');

    loader.load(
      'hand_model.fbx',

      // ── onLoad ──
      (fbx) => {
        // Centraliza e escala o modelo ao container
        const box    = new THREE.Box3().setFromObject(fbx);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Normaliza para ~200 unidades de altura
        const escala = 200 / maxDim;
        fbx.scale.setScalar(escala);

        // Centraliza na origem
        fbx.position.set(
          -center.x * escala,
          -center.y * escala,
          -center.z * escala
        );

        // Sombras em todos os meshes
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;

            // Aplica material de alta qualidade se o modelo não tiver materiais próprios
            if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
              child.material = new THREE.MeshStandardMaterial({
                color:     0xf0f2f5,
                roughness: 0.25,
                metalness: 0.12
              });
            }
          }
        });

        this.model = fbx;
        this.scene.add(fbx);

        // Ajusta raio de órbita com base no tamanho real do modelo
        this.orbitaRaio = maxDim * escala * 1.9;
        this._atualizarPosicaoCamera();

        // Animações internas do FBX (se existirem)
        if (fbx.animations && fbx.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(fbx);
          const action = this.mixer.clipAction(fbx.animations[0]);
          action.play();
        }

        // Remove spinner
        if (spinner) {
          spinner.style.transition = 'opacity 0.4s';
          spinner.style.opacity    = '0';
          setTimeout(() => {
            if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
          }, 450);
        }
      },

      // ── onProgress ──
      (xhr) => {
        if (xhr.lengthComputable && spinner) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          const txt = spinner.querySelector('span:last-child');
          if (txt) txt.textContent = `Carregando Modelo 3D… ${pct}%`;
        }
      },

      // ── onError ──
      (err) => {
        console.error('[Viewer3D] Erro ao carregar FBX:', err);
        if (spinner) {
          const txt = spinner.querySelector('span:last-child');
          if (txt) txt.textContent = 'Erro ao carregar modelo 3D.';
        }
      }
    );
  }

  // ----------------------------------------------------------
  // _atualizarPosicaoCamera()
  // ----------------------------------------------------------
  _atualizarPosicaoCamera() {
    if (!this.camera) return;
    const r   = this.orbitaRaio;
    const phi = Math.max(0.05, Math.min(Math.PI * 0.85, this.orbitaPhi));
    this.camera.position.set(
      r * Math.sin(phi) * Math.sin(this.orbitaTheta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.cos(this.orbitaTheta)
    );
    this.camera.lookAt(0, 0, 0);
  }

  // ----------------------------------------------------------
  // _configurarControles() — drag para orbitar, scroll para zoom
  // ----------------------------------------------------------
  _configurarControles() {
    const el = this.renderer.domElement;

    // ── Pointer Down ──
    this._handlers.pdown = (e) => {
      this.arrastando  = true;
      this.autoRotando = false;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };
    el.addEventListener('pointerdown', this._handlers.pdown, { passive: false });

    // ── Pointer Move ──
    this._handlers.pmove = (e) => {
      if (!this.arrastando) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.orbitaTheta -= dx * 0.008;
      this.orbitaPhi   -= dy * 0.006;
      this.orbitaPhi    = Math.max(0.05, Math.min(Math.PI * 0.85, this.orbitaPhi));
      this.lastPointer  = { x: e.clientX, y: e.clientY };
      this._atualizarPosicaoCamera();
    };
    window.addEventListener('pointermove', this._handlers.pmove);

    // ── Pointer Up ──
    this._handlers.pup = () => { this.arrastando = false; };
    window.addEventListener('pointerup', this._handlers.pup);

    // ── Wheel (zoom) ──
    this._handlers.wheel = (e) => {
      this.orbitaRaio = Math.max(50, Math.min(1200, this.orbitaRaio + e.deltaY * 0.5));
      this._atualizarPosicaoCamera();
      e.preventDefault();
    };
    el.addEventListener('wheel', this._handlers.wheel, { passive: false });

    // ── Touch (pinch zoom) ──
    let lastDist = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.orbitaRaio = Math.max(50, Math.min(1200, this.orbitaRaio - (d - lastDist) * 1.2));
        lastDist = d;
        this._atualizarPosicaoCamera();
      }
    }, { passive: true });
  }

  // ----------------------------------------------------------
  // _loop() — loop principal de renderização
  // ----------------------------------------------------------
  _loop() {
    this.rafId = requestAnimationFrame(() => this._loop());

    const delta = this.clock.getDelta();

    // Mixer de animações FBX
    if (this.mixer) this.mixer.update(delta);

    // Auto-rotação suave
    if (this.autoRotando && !this.arrastando) {
      this.orbitaTheta += delta * 0.22;
      this._atualizarPosicaoCamera();
    }

    this._resize();
    this.renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------
  // _resize()
  // ----------------------------------------------------------
  _resize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth  || 680;
    const h = this.container.clientHeight || 480;
    if (Math.abs(w - this._lastW) <= 1 && Math.abs(h - this._lastH) <= 1) return;
    this._lastW = w;
    this._lastH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------
  // API pública
  // ----------------------------------------------------------
  toggleRotacao() {
    this.autoRotando = !this.autoRotando;
    return this.autoRotando;
  }

  resetarCamera() {
    this.autoRotando = false;
    this.orbitaTheta = 0;
    this.orbitaPhi   = 0.30;
    this._atualizarPosicaoCamera();
  }

  destruir() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this._resizeObs) this._resizeObs.disconnect();
    if (this._handlers.resize) window.removeEventListener('resize', this._handlers.resize);
    if (this._handlers.pmove)  window.removeEventListener('pointermove', this._handlers.pmove);
    if (this._handlers.pup)    window.removeEventListener('pointerup',   this._handlers.pup);
    if (this.renderer && this.renderer.domElement) {
      const el = this.renderer.domElement;
      if (this._handlers.pdown) el.removeEventListener('pointerdown', this._handlers.pdown);
      if (this._handlers.wheel) el.removeEventListener('wheel',       this._handlers.wheel);
    }
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material])
            .forEach((m) => m && m.dispose && m.dispose());
        }
      });
    }
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    this.renderer = this.scene = this.camera = this.model = null;
  }
}

// Exposição global
window.Viewer3DModelo = Viewer3DModelo;
