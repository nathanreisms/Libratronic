// ============================================================
// hand3d.js — LibraTronic v4.0 (ES6+ Bionic Kinematics Engine)
// Mão Robótica Biônica 3D Articulada de Alta Precisão com Three.js
// Destaques da Arquitetura v4.0:
//  - Geometria Biônica Remodelada: Palma chanfrada via ExtrudeGeometry,
//    placas metacarpais dorsais, pistões hidráulicos, juntas de duplo
//    anel em titânio, escudos dorsais nas falanges e sensores táteis LED.
//  - Motor de Animação Física: Interpolação exponencial independente de
//    taxa de quadros (frame-rate independent damping) com cascata de
//    tendões (MCP -> PIP -> DIP) + smoothLerp com curvas de easing.
//  - Cinemática Espacial Libras + Rastro Holográfico 3D (Motion Trail):
//    Traçado geométrico real no espaço 3D para 'J', 'Z', 'H', 'K', 'X'
//    e sinais compostos, desenhando a trajetória luminosa da ponta do dedo.
//  - Performance Extrema & Zero Memory Leaks: Page Visibility API,
//    ResizeObserver e limpeza profunda de buffers WebGL (dispose).
// ============================================================

'use strict';

// ============================================================
// 1. MOTOR DE INTERPOLAÇÃO: smoothLerp (ES6+ com WeakMap e Easing)
// ============================================================
const _lerpRegistry = new WeakMap();

const Easing = {
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t) => {
    const c1 = 1.45;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
};

/**
 * Interpola propriedades numéricas de um objeto com cancelamento automático
 * de animações concorrentes no mesmo alvo.
 * @param {Object} obj Objeto alvo (ex: mesh.position, camera.position)
 * @param {Object} targets Mapa de chaves e valores finais
 * @param {number} [durationMs=420] Duração em milissegundos
 * @param {Function} [easingFn=Easing.easeInOutCubic] Função de easing
 * @param {Function} [onUpdate] Callback opcional por frame
 */
function smoothLerp(obj, targets, durationMs = 420, easingFn = Easing.easeInOutCubic, onUpdate = null) {
  if (!obj || !targets) return;

  if (_lerpRegistry.has(obj)) {
    cancelAnimationFrame(_lerpRegistry.get(obj));
    _lerpRegistry.delete(obj);
  }

  const keys = Object.keys(targets);
  const start = {};
  for (const k of keys) {
    start[k] = Number(obj[k]) || 0;
  }

  const t0 = performance.now();
  const dur = Math.max(Number(durationMs) || 420, 16);
  const ease = typeof easingFn === 'function' ? easingFn : Easing.easeInOutCubic;

  const tick = (now) => {
    const progress = Math.min((now - t0) / dur, 1);
    const factor = ease(progress);

    for (const k of keys) {
      obj[k] = start[k] + (targets[k] - start[k]) * factor;
    }

    if (typeof onUpdate === 'function') {
      onUpdate(progress);
    }

    if (progress < 1) {
      const id = requestAnimationFrame(tick);
      _lerpRegistry.set(obj, id);
    } else {
      _lerpRegistry.delete(obj);
    }
  };

  const firstId = requestAnimationFrame(tick);
  _lerpRegistry.set(obj, firstId);
}

// Interpolação amortecida independente de FPS (Frame-rate independent damping)
function damp(current, target, lambda, delta) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/**
 * Integrador Físico de Mola Criticamente Amortecida de 2ª Ordem (Critically Damped Spring):
 * Produz aceleração suave na partida e desaceleração orgânica na chegada,
 * eliminando travamentos robóticos bruscos entre trocas de sinais.
 */
function springStep(current, velocity, target, omega, delta) {
  const dt = Math.min(delta, 0.05);
  const exp = Math.exp(-omega * dt);
  const diff = current - target;
  const temp = (velocity + omega * diff) * dt;
  const nextPos = target + (diff + temp) * exp;
  const nextVel = (velocity - omega * temp) * exp;
  return [nextPos, nextVel];
}

// Interpolação linear simples com clamp
function lerpVal(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// ============================================================
// 1.5 GERADOR PROCEDURAL DE TEXTURAS PBR (CanvasTexture)
// ============================================================
const BionicTextureFactory = {
  criarTexturaPolimero3D() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Base cerâmica acetinada clara
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(0, 0, 256, 256);

    // Micro-camadas sutis de manufatura aditiva de alta resolução (SLA/SLS)
    for (let y = 0; y < 256; y += 2) {
      const lum = y % 4 === 0 ? 248 : 235;
      ctx.fillStyle = `rgb(${lum}, ${lum + 1}, ${lum + 3})`;
      ctx.fillRect(0, y, 256, 1);
    }

    // Grade celular hexagonal técnica ultra-sutil
    ctx.strokeStyle = 'rgba(175, 186, 198, 0.16)';
    ctx.lineWidth = 0.8;
    const r = 14;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);
    for (let gx = 0; gx < 256 + dx; gx += dx) {
      for (let gy = 0; gy < 256 + dy; gy += dy) {
        const offsetY = Math.round(gx / dx) % 2 === 0 ? 0 : dy / 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i;
          const px = gx + r * 0.65 * Math.cos(ang);
          const py = gy + offsetY + r * 0.65 * Math.sin(ang);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Linhas de costura de painéis aeroespaciais
    ctx.strokeStyle = 'rgba(150, 164, 178, 0.22)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(6, 6, 244, 244);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  },

  criarTexturaFibraCarbono() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#121418';
    ctx.fillRect(0, 0, 128, 128);

    // Trama diagonal 2x2 Twill de Fibra de Carbono + relevo tátil
    const passo = 8;
    for (let y = 0; y < 128; y += passo) {
      for (let x = 0; x < 128; x += passo) {
        const fase = ((x / passo) + (y / passo)) % 4;
        if (fase === 0 || fase === 1) {
          ctx.fillStyle = fase === 0 ? '#242932' : '#1d2129';
          ctx.fillRect(x, y, passo - 1, passo - 1);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
          ctx.fillRect(x, y, passo - 1, 2);
        } else {
          ctx.fillStyle = '#0e1014';
          ctx.fillRect(x, y, passo - 1, passo - 1);
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    return tex;
  },

  criarTexturaMetalEscovado() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#808690';
    ctx.fillRect(0, 0, 256, 256);

    // Micro-estrias horizontais de usinagem CNC / titânio escovado
    for (let y = 0; y < 256; y++) {
      const variacao = Math.sin(y * 0.9) * 14 + Math.cos(y * 2.7) * 9;
      const v = Math.max(90, Math.min(185, Math.round(132 + variacao)));
      ctx.fillStyle = `rgb(${v}, ${v + 2}, ${v + 5})`;
      ctx.fillRect(0, y, 256, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }
};

// ============================================================
// 2. CLASSE: MaoRobotica (Modelo Biônico Articulado + Rastro 3D)
// ============================================================
class MaoRobotica {
  constructor(scene, posicaoX = 0, espelhar = false) {
    this.scene = scene;
    this.posicaoX = posicaoX;
    this.espelhar = espelhar;

    // Grupo raiz (controla posição X da mão direita/esquerda e espelhamento)
    this.grupo = new THREE.Group();

    // Grupo do antebraço (base estrutural estabilizada + translação espacial do braço)
    this.grupoAntebraco = new THREE.Group();
    this.grupo.add(this.grupoAntebraco);

    // Anel cardânico intermediário (segue 50% da inclinação do pulso para realismo mecânico)
    this.anelCardanIntermediario = new THREE.Group();
    this.anelCardanIntermediario.position.set(0, -0.02, 0);
    this.grupoAntebraco.add(this.anelCardanIntermediario);

    // Grupo do pulso (articulação esférica 3-DOF real no centro do carpo y=0)
    // Rotaciona a palma e os dedos independentemente do antebraço!
    this.grupoPulso = new THREE.Group();
    this.grupoPulso.position.set(0, 0, 0);
    this.grupoAntebraco.add(this.grupoPulso);

    this.dedos = {};
    this.pulso = {
      alvoX: 0, alvoY: 0, alvoZ: 0,
      atualX: 0, atualY: 0, atualZ: 0,
      velX: 0, velY: 0, velZ: 0
    };

    // Estado cinemático suavizado da trajetória espacial (evita teleporte entre poses e ciclos)
    this.trajetoria = {
      px: 0, py: 0, pz: 0,
      vpx: 0, vpy: 0, vpz: 0,
      rx: 0, ry: 0, rz: 0,
      vrx: 0, vry: 0, vrz: 0
    };

    // Referências às hastes dos pistões hidráulicos do pulso p/ compressão/extensão dinâmica
    this.hastesPistao = [];
    this._texturasProcedurais = [];

    this.movimentoAtivo = null;
    this.tempoMovimento = 0;
    this.tempoGlobal = Math.random() * 10;

    // Rastro Holográfico 3D (Motion Trail para J, Z e sinais dinâmicos)
    this.rastroAtivo = true;
    this.gravandoRastro = false;
    this.dedoRastro = null;
    this.maxPontosRastro = 360;
    this.maxVerticesLinha = 480;
    this.pontosRastro = [];
    this.linhaRastro = null;
    this.pontoCursorRastro = null;
    this._vecTemp = new THREE.Vector3();

    this._inicializarMateriais();
  }

  _inicializarMateriais() {
    const ehMobile =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 980px), (pointer: coarse)').matches;

    const texPolimero = BionicTextureFactory.criarTexturaPolimero3D();
    const texCarbono  = BionicTextureFactory.criarTexturaFibraCarbono();
    const texMetal    = BionicTextureFactory.criarTexturaMetalEscovado();
    this._texturasProcedurais.push(texPolimero, texCarbono, texMetal);

    const MatClass =
      !ehMobile && THREE.MeshPhysicalMaterial
        ? THREE.MeshPhysicalMaterial
        : THREE.MeshStandardMaterial;

    // Polímero Técnico / Cerâmica Aeroespacial Branca Texturizada
    this.matBranco = new MatClass({
      color: 0xf5f6f8,
      map: texPolimero,
      bumpMap: texPolimero,
      bumpScale: 0.0055,
      roughness: 0.22,
      metalness: 0.10,
      ...(!ehMobile && THREE.MeshPhysicalMaterial
        ? { clearcoat: 0.36, clearcoatRoughness: 0.20 }
        : {})
    });

    // Titânio Space Gray Anodizado Escovado (Juntas, rolamentos e atuadores)
    this.matMetal = new THREE.MeshStandardMaterial({
      color: 0x3b404a,
      bumpMap: texMetal,
      bumpScale: 0.006,
      roughness: 0.26,
      metalness: 0.86
    });

    // Aço Inoxidável / Cromo Usinado (Hastes de pistões, tendões e eixos de precisão)
    this.matCromo = new THREE.MeshStandardMaterial({
      color: 0xd8dfe6,
      bumpMap: texMetal,
      bumpScale: 0.0035,
      roughness: 0.14,
      metalness: 0.93
    });

    // Compósito de Fibra de Carbono 2x2 Twill (Chassi interno, fole carpal e sensores palmares)
    this.matDetalhe = new THREE.MeshStandardMaterial({
      color: 0x1a1d23,
      map: texCarbono,
      bumpMap: texCarbono,
      bumpScale: 0.011,
      roughness: 0.44,
      metalness: 0.38
    });

    // Indicador Luminoso Ciano-Prateado Dessaturado (Telemetria limpa e discreta)
    this.matNeon = new THREE.MeshStandardMaterial({
      color: 0xc2dceb,
      roughness: 0.16,
      metalness: 0.15,
      emissive: new THREE.Color(0x6e9bb3),
      emissiveIntensity: 0.72
    });
  }

  criar() {
    this.grupo.position.set(this.posicaoX, -0.18, 0);
    if (this.espelhar) {
      this.grupo.scale.x = -1;
    }

    this._criarPulsoEAntebraco();
    this._criarPalmaBionica();

    // 4 dedos principais: (nome, ox, oy, raio, [prox, med, dist], incZ, cascata)
    this._criarDedo('mindinho',  -0.55, 0.95, 0.088, [0.48, 0.33, 0.25],  0.09, 0.90);
    this._criarDedo('anelar',    -0.19, 1.02, 0.098, [0.58, 0.39, 0.27],  0.03, 0.95);
    this._criarDedo('medio',      0.17, 1.06, 0.105, [0.64, 0.42, 0.29],  0.00, 1.00);
    this._criarDedo('indicador',  0.53, 1.00, 0.100, [0.57, 0.38, 0.27], -0.04, 1.05);

    this._criarPolegarOpositor();
    this._criarSistemaRastro3D();

    this.scene.add(this.grupo);
  }

  // ----------------------------------------------------------
  // _criarPulsoEAntebraco()
  // Articulação cardânica de pulso 3-DOF independente do antebraço + pistões ativos
  // ----------------------------------------------------------
  _criarPulsoEAntebraco() {
    // ── 1. ESTRUTURA DO ANTEBRAÇO (Fixada em this.grupoAntebraco) ──
    const bercoPulso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.39, 0.43, 0.18, 24),
      this.matBranco
    );
    bercoPulso.position.y = -0.19;
    bercoPulso.castShadow = true;
    this.grupoAntebraco.add(bercoPulso);

    // Garfos laterais de titânio (Yokes do Cardan) com calotas de encoder e anel LED
    for (const sinalX of [-1, 1]) {
      const garfo = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.25, 0.185),
        this.matMetal
      );
      garfo.position.set(sinalX * 0.365, -0.055, 0);
      this.grupoAntebraco.add(garfo);

      const pinoCardan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.095, 16),
        this.matCromo
      );
      pinoCardan.rotation.z = Math.PI / 2;
      pinoCardan.position.set(sinalX * 0.378, -0.015, 0);
      this.grupoAntebraco.add(pinoCardan);

      const anelEncoder = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.009, 8, 20),
        this.matNeon
      );
      anelEncoder.rotation.y = Math.PI / 2;
      anelEncoder.position.set(sinalX * 0.422, -0.015, 0);
      this.grupoAntebraco.add(anelEncoder);
    }

    // Anel LED luminoso de telemetria no topo do antebraço
    const anelLed = new THREE.Mesh(
      new THREE.TorusGeometry(0.425, 0.022, 12, 36),
      this.matNeon
    );
    anelLed.rotation.x = Math.PI / 2;
    anelLed.position.y = -0.28;
    this.grupoAntebraco.add(anelLed);

    // Carcaça principal do antebraço biônico
    const antebraco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.39, 0.48, 0.54, 24),
      this.matBranco
    );
    antebraco.position.y = -0.56;
    antebraco.castShadow = true;
    antebraco.receiveShadow = true;
    this.grupoAntebraco.add(antebraco);

    // Recortes técnicos em fibra de carbono no antebraço (frontal e dorsal)
    const placaAntebraco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.405, 0.46, 0.34, 16, 1, false, -0.55, 1.1),
      this.matDetalhe
    );
    placaAntebraco.position.y = -0.55;
    this.grupoAntebraco.add(placaAntebraco);

    const placaAntebracoDorso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.405, 0.46, 0.34, 16, 1, false, Math.PI - 0.55, 1.1),
      this.matDetalhe
    );
    placaAntebracoDorso.position.y = -0.55;
    this.grupoAntebraco.add(placaAntebracoDorso);

    // Flange metálica de fechamento inferior do antebraço
    const anelBase = new THREE.Mesh(
      new THREE.TorusGeometry(0.475, 0.038, 12, 28),
      this.matMetal
    );
    anelBase.rotation.x = Math.PI / 2;
    anelBase.position.y = -0.82;
    this.grupoAntebraco.add(anelBase);

    // ── 2. ANEL CARDÂNICO INTERMEDIÁRIO + FOLE CARPAL SEGMENTADO ──
    const anelCardanExt = new THREE.Mesh(
      new THREE.TorusGeometry(0.345, 0.028, 14, 36),
      this.matCromo
    );
    anelCardanExt.rotation.x = Math.PI / 2;
    this.anelCardanIntermediario.add(anelCardanExt);

    // Fole flexível de fibra de carbono que veda a transição interna do pulso
    for (const fy of [-0.07, -0.02, 0.03]) {
      const anelFole = new THREE.Mesh(
        new THREE.TorusGeometry(0.285, 0.028, 10, 24),
        this.matDetalhe
      );
      anelFole.rotation.x = Math.PI / 2;
      anelFole.position.y = fy;
      this.anelCardanIntermediario.add(anelFole);
    }

    // ── 3. JUNTA ESFÉRICA E COLAR DO CARPO (Fixados em this.grupoPulso, pivô em y=0) ──
    const esferaPulso = new THREE.Mesh(
      new THREE.SphereGeometry(0.305, 24, 20),
      this.matMetal
    );
    esferaPulso.position.y = -0.015;
    this.grupoPulso.add(esferaPulso);

    // Anéis equatoriais cruzados cromados no núcleo esférico do pulso
    const anelRotorPulso = new THREE.Mesh(
      new THREE.TorusGeometry(0.312, 0.019, 12, 32),
      this.matCromo
    );
    anelRotorPulso.position.y = -0.015;
    this.grupoPulso.add(anelRotorPulso);

    // Colar carpal superior que conecta o pivô do pulso à base da palma
    const colarCarpo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.30, 0.14, 22),
      this.matDetalhe
    );
    colarCarpo.position.y = 0.05;
    this.grupoPulso.add(colarCarpo);

    // ── 4. 4 PISTÕES HIDRÁULICOS ATIVOS (Camisa no antebraço + Haste dinâmica) ──
    this.hastesPistao = [];
    const offsetsPistao = [
      [-0.32,  0.145],
      [ 0.32,  0.145],
      [-0.30, -0.145],
      [ 0.30, -0.145]
    ];
    for (const [px, pz] of offsetsPistao) {
      const camisa = new THREE.Mesh(
        new THREE.CylinderGeometry(0.054, 0.054, 0.35, 12),
        this.matMetal
      );
      camisa.position.set(px, -0.47, pz);
      this.grupoAntebraco.add(camisa);

      const anelVedacao = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.010, 8, 16),
        this.matCromo
      );
      anelVedacao.rotation.x = Math.PI / 2;
      anelVedacao.position.set(px, -0.30, pz);
      this.grupoAntebraco.add(anelVedacao);

      const haste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.030, 0.030, 0.34, 12),
        this.matCromo
      );
      haste.position.set(px, -0.21, pz);
      this.grupoAntebraco.add(haste);

      // Rótula superior na extremidade da haste do pistão
      const rotula = new THREE.Mesh(
        new THREE.SphereGeometry(0.044, 10, 10),
        this.matMetal
      );
      rotula.position.y = 0.16;
      haste.add(rotula);

      this.hastesPistao.push({
        mesh: haste,
        camisa,
        px,
        pz,
        baseY: -0.21
      });
    }
  }

  // ----------------------------------------------------------
  // _criarPalmaBionica()
  // Palma anatômica chanfrada com ExtrudeGeometry, metacarpos e reator LED
  // ----------------------------------------------------------
  _criarPalmaBionica() {
    // Silhueta anatômica trapezoidada da palma (mais larga nos knuckles, afunilada no carpo)
    const shapePalma = new THREE.Shape();
    shapePalma.moveTo(-0.56, 0.02);
    shapePalma.lineTo(0.56, 0.02);
    shapePalma.quadraticCurveTo(0.70, 0.22, 0.68, 0.82);
    shapePalma.quadraticCurveTo(0.64, 0.94, 0.48, 0.94);
    shapePalma.lineTo(-0.48, 0.94);
    shapePalma.quadraticCurveTo(-0.64, 0.94, -0.68, 0.82);
    shapePalma.quadraticCurveTo(-0.70, 0.22, -0.56, 0.02);

    const extrudeSettings = {
      steps: 1,
      depth: 0.20,
      bevelEnabled: true,
      bevelThickness: 0.055,
      bevelSize: 0.045,
      bevelSegments: 5
    };

    const geoPalma = new THREE.ExtrudeGeometry(shapePalma, extrudeSettings);
    geoPalma.center();

    const malhaPalma = new THREE.Mesh(geoPalma, this.matBranco);
    malhaPalma.position.set(0, 0.47, 0);
    malhaPalma.castShadow = true;
    malhaPalma.receiveShadow = true;
    this.grupoPulso.add(malhaPalma);

    // Chassi palmar interno segmentado em Fibra de Carbono (almofadas táteis de aderência)
    const padSup = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.28, 0.048),
      this.matDetalhe
    );
    padSup.position.set(0, 0.69, 0.145);
    this.grupoPulso.add(padSup);

    const padInfEsq = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.34, 0.048),
      this.matDetalhe
    );
    padInfEsq.position.set(-0.30, 0.30, 0.142);
    this.grupoPulso.add(padInfEsq);

    // Eminência tenar (músculo mecânico opositor na base do polegar com colar CMC)
    const tenar = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 20, 16),
      this.matDetalhe
    );
    tenar.scale.set(1.15, 1.38, 0.76);
    tenar.position.set(0.46, 0.26, 0.11);
    this.grupoPulso.add(tenar);

    // Blindagem dorsal e nervuras metacarpais (4 tendões mecânicos cromados no dorso)
    const placaDorsal = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.62, 0.048),
      this.matDetalhe
    );
    placaDorsal.position.set(0, 0.46, -0.145);
    this.grupoPulso.add(placaDorsal);

    const posMetacarpos = [-0.50, -0.17, 0.17, 0.50];
    for (const mx of posMetacarpos) {
      const tendaoDorsal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.028, 0.68, 10),
        this.matCromo
      );
      tendaoDorsal.position.set(mx * 0.92, 0.52, -0.166);
      tendaoDorsal.rotation.z = -mx * 0.10;
      this.grupoPulso.add(tendaoDorsal);

      // Anel guia de tendão no dorso
      const guiaTendao = new THREE.Mesh(
        new THREE.TorusGeometry(0.032, 0.008, 8, 14),
        this.matMetal
      );
      guiaTendao.rotation.x = Math.PI / 2;
      guiaTendao.position.set(mx * 0.95, 0.76, -0.166);
      this.grupoPulso.add(guiaTendao);
    }

    // Núcleo Energético Biônico (Palma e Dorso)
    const nucleoAnelGeo = new THREE.RingGeometry(0.105, 0.165, 32);
    const nucleoCentroGeo = new THREE.CircleGeometry(0.075, 28);

    const nucleoFrente = new THREE.Mesh(nucleoAnelGeo, this.matNeon);
    nucleoFrente.position.set(-0.02, 0.46, 0.174);
    this.grupoPulso.add(nucleoFrente);

    const centroFrente = new THREE.Mesh(nucleoCentroGeo, this.matNeon);
    centroFrente.position.set(-0.02, 0.46, 0.173);
    this.grupoPulso.add(centroFrente);

    const nucleoDorso = new THREE.Mesh(nucleoAnelGeo, this.matNeon);
    nucleoDorso.rotation.y = Math.PI;
    nucleoDorso.position.set(0, 0.46, -0.174);
    this.grupoPulso.add(nucleoDorso);

    // Knuckles (Juntas Metacarpofalangeanas MCP com anel duplo de retenção e eixo cromado)
    const posKnuckles = [
      [-0.55, 0.93, 0.088],
      [-0.19, 1.00, 0.098],
      [ 0.17, 1.04, 0.105],
      [ 0.53, 0.98, 0.100]
    ];
    for (const [kx, ky, kr] of posKnuckles) {
      const knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(kr * 1.16, 16, 14),
        this.matMetal
      );
      knuckle.position.set(kx, ky, 0);
      this.grupoPulso.add(knuckle);

      const pinoKnuckle = new THREE.Mesh(
        new THREE.CylinderGeometry(kr * 0.44, kr * 0.44, kr * 2.48, 12),
        this.matCromo
      );
      pinoKnuckle.rotation.z = Math.PI / 2;
      pinoKnuckle.position.set(kx, ky, 0);
      this.grupoPulso.add(pinoKnuckle);

      for (const s of [-1, 1]) {
        const anelRetencao = new THREE.Mesh(
          new THREE.TorusGeometry(kr * 0.88, kr * 0.14, 10, 20),
          this.matCromo
        );
        anelRetencao.rotation.y = Math.PI / 2;
        anelRetencao.position.set(kx + s * kr * 0.72, ky, 0);
        this.grupoPulso.add(anelRetencao);
      }
    }
  }

  // ----------------------------------------------------------
  // _criarDedo(nome, ox, oy, raio, comps, incZ, cascata)
  // Cria um dedo com 3 falanges articuladas e ponteira de rastreio
  // ----------------------------------------------------------
  _criarDedo(nome, ox, oy, raio, comps, incZ = 0, cascata = 1.0) {
    const grupoBase = new THREE.Group();
    grupoBase.position.set(ox, oy, 0);
    grupoBase.rotation.z = incZ;

    // 1. Falange Proximal
    const fProx = this._criarSegmentoFalange(raio, comps[0], false);
    grupoBase.add(fProx);

    // 2. Junta PIP (Interfalangeana Proximal)
    const juntaMid = new THREE.Group();
    juntaMid.position.y = comps[0];
    this._adicionarJuntaMecanica(juntaMid, raio * 0.88);
    grupoBase.add(juntaMid);

    // 3. Falange Média
    const fMed = this._criarSegmentoFalange(raio * 0.85, comps[1], false);
    juntaMid.add(fMed);

    // 4. Junta DIP (Interfalangeana Distal)
    const juntaDist = new THREE.Group();
    juntaDist.position.y = comps[1];
    this._adicionarJuntaMecanica(juntaDist, raio * 0.76);
    juntaMid.add(juntaDist);

    // 5. Falange Distal + Sensor Tátil LED + Marcador de Ponta (Tip Anchor)
    const fDist = this._criarSegmentoFalange(raio * 0.74, comps[2], true);
    juntaDist.add(fDist);

    const pontaAnchor = new THREE.Object3D();
    pontaAnchor.position.set(0, comps[2] + raio * 0.65, raio * 0.35);
    juntaDist.add(pontaAnchor);

    this.grupoPulso.add(grupoBase);

    this.dedos[nome] = {
      base: grupoBase,
      mid: juntaMid,
      dist: juntaDist,
      ponta: pontaAnchor,
      defaultZ: incZ,
      cascata,
      alvoX: 0.05, alvoMidX: 0.05, alvoDistX: 0.04,
      alvoY: 0,    alvoZ: incZ,
      atualX: 0.05, atualMidX: 0.05, atualDistX: 0.04,
      atualY: 0,    atualZ: incZ,
      velX: 0, velMidX: 0, velDistX: 0,
      velY: 0, velZ: 0
    };
  }

  // ----------------------------------------------------------
  // _criarPolegarOpositor()
  // Polegar com articulação Carpometacarpal (CMC) + MCP + IP
  // ----------------------------------------------------------
  _criarPolegarOpositor() {
    const grupoBase = new THREE.Group();
    grupoBase.position.set(0.72, 0.25, 0.13);
    grupoBase.rotation.set(0.10, 0.20, -1.05);

    this._adicionarJuntaMecanica(grupoBase, 0.125);

    const fProx = this._criarSegmentoFalange(0.118, 0.44, false);
    grupoBase.add(fProx);

    const juntaIP = new THREE.Group();
    juntaIP.position.y = 0.44;
    this._adicionarJuntaMecanica(juntaIP, 0.102);
    grupoBase.add(juntaIP);

    const fDist = this._criarSegmentoFalange(0.098, 0.36, true);
    juntaIP.add(fDist);

    const pontaAnchor = new THREE.Object3D();
    pontaAnchor.position.set(0, 0.42, 0.04);
    juntaIP.add(pontaAnchor);

    this.grupoPulso.add(grupoBase);

    this.dedos.polegar = {
      base: grupoBase,
      mid: juntaIP,
      dist: null,
      ponta: pontaAnchor,
      defaultZ: -1.05,
      cascata: 1.06,
      alvoX: 0.05, alvoMidX: 0.05, alvoDistX: 0,
      alvoY: 0.20, alvoZ: -1.05,
      atualX: 0.05, atualMidX: 0.05, atualDistX: 0,
      atualY: 0.20, atualZ: -1.05,
      velX: 0, velMidX: 0, velDistX: 0,
      velY: 0, velZ: 0
    };
  }

  // ----------------------------------------------------------
  // _criarSegmentoFalange(raio, altura, comPonta)
  // ----------------------------------------------------------
  _criarSegmentoFalange(raio, altura, comPonta) {
    const grupo = new THREE.Group();

    // Carcaça estrutural cônica-cilíndrica em polímero cerâmico texturizado
    const cilGeo = new THREE.CylinderGeometry(raio * 0.87, raio, altura, 20, 1);
    const cil = new THREE.Mesh(cilGeo, this.matBranco);
    cil.position.y = altura / 2;
    cil.castShadow = true;
    cil.receiveShadow = true;
    grupo.add(cil);

    // Escudo dorsal chanfrado (placa de blindagem traseira do dedo -Z)
    const escudoGeo = new THREE.BoxGeometry(raio * 1.36, altura * 0.74, raio * 0.34);
    const escudo = new THREE.Mesh(escudoGeo, this.matBranco);
    escudo.position.set(0, altura * 0.52, -raio * 0.78);
    grupo.add(escudo);

    // Haste de tendão extensor cromada ao longo do dorso da falange
    const tendaoFalange = new THREE.Mesh(
      new THREE.CylinderGeometry(raio * 0.14, raio * 0.14, altura * 0.84, 8),
      this.matCromo
    );
    tendaoFalange.position.set(0, altura * 0.50, -raio * 0.96);
    grupo.add(tendaoFalange);

    // Almofada palmar interna de aderência em Fibra de Carbono (+Z)
    const padGeo = new THREE.BoxGeometry(raio * 1.38, altura * 0.66, raio * 0.36);
    const pad = new THREE.Mesh(padGeo, this.matDetalhe);
    pad.position.set(0, altura * 0.50, raio * 0.80);
    grupo.add(pad);

    // Anéis cromados técnicos de tensão (proximal e distal)
    const anelProxGeo = new THREE.CylinderGeometry(raio * 0.97, raio * 0.97, altura * 0.08, 16);
    const anelProx = new THREE.Mesh(anelProxGeo, this.matCromo);
    anelProx.position.y = altura * 0.18;
    grupo.add(anelProx);

    const anelDistGeo = new THREE.CylinderGeometry(raio * 0.90, raio * 0.90, altura * 0.06, 16);
    const anelDist = new THREE.Mesh(anelDistGeo, this.matMetal);
    anelDist.position.y = altura * 0.82;
    grupo.add(anelDist);

    if (comPonta) {
      // Cúpula hemisférica anatômica na extremidade distal
      const cupolaGeo = new THREE.SphereGeometry(
        raio * 0.87, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2
      );
      const cupola = new THREE.Mesh(cupolaGeo, this.matBranco);
      cupola.position.y = altura;
      grupo.add(cupola);

      // Placa ungueal biônica (unha técnica metálica escovada no dorso da ponta)
      const unhaGeo = new THREE.BoxGeometry(raio * 1.12, altura * 0.44, raio * 0.18);
      const unha = new THREE.Mesh(unhaGeo, this.matMetal);
      unha.position.set(0, altura * 0.82, -raio * 0.76);
      unha.rotation.x = 0.14;
      grupo.add(unha);

      // Sensor óptico-tátil LED neon na polpa digital (+Z)
      const sensorGeo = new THREE.SphereGeometry(raio * 0.46, 14, 12);
      const sensor = new THREE.Mesh(sensorGeo, this.matNeon);
      sensor.scale.set(1.0, 1.25, 0.46);
      sensor.position.set(0, altura * 0.78, raio * 0.80);
      grupo.add(sensor);
    }

    return grupo;
  }

  // ----------------------------------------------------------
  // _adicionarJuntaMecanica(grupoJunta, raio)
  // Articulação mecânica de duplo anel (Double-Clevis Hinge) + guarda palmar
  // ----------------------------------------------------------
  _adicionarJuntaMecanica(grupoJunta, raio) {
    // Núcleo esférico de rolamento em titânio escovado
    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(raio * 0.94, 16, 14),
      this.matMetal
    );
    grupoJunta.add(esfera);

    // Guarda flexora interna em fibra de carbono (veda o vão articular ao dobrar)
    const guardaFlexao = new THREE.Mesh(
      new THREE.CylinderGeometry(raio * 0.78, raio * 0.78, raio * 1.55, 14),
      this.matDetalhe
    );
    guardaFlexao.rotation.z = Math.PI / 2;
    guardaFlexao.position.z = raio * 0.22;
    grupoJunta.add(guardaFlexao);

    // Anéis laterais cromados de retenção da dobradiça (Double-Clevis Rings)
    for (const sinal of [-1, 1]) {
      const anelClevis = new THREE.Mesh(
        new THREE.TorusGeometry(raio * 0.76, raio * 0.13, 10, 20),
        this.matCromo
      );
      anelClevis.rotation.y = Math.PI / 2;
      anelClevis.position.x = sinal * raio * 0.68;
      grupoJunta.add(anelClevis);

      // Calota lateral de fechamento do pino
      const calotaPino = new THREE.Mesh(
        new THREE.CylinderGeometry(raio * 0.24, raio * 0.24, raio * 0.12, 10),
        this.matDetalhe
      );
      calotaPino.rotation.z = Math.PI / 2;
      calotaPino.position.x = sinal * raio * 1.15;
      grupoJunta.add(calotaPino);
    }

    // Eixo transversal de aço cromado
    const eixo = new THREE.Mesh(
      new THREE.CylinderGeometry(raio * 0.36, raio * 0.36, raio * 2.26, 12),
      this.matCromo
    );
    eixo.rotation.z = Math.PI / 2;
    grupoJunta.add(eixo);
  }

  // ----------------------------------------------------------
  // _criarSistemaRastro3D()
  // Linha holográfica neon que desenha o traçado de J, Z e gestos no ar
  // ----------------------------------------------------------
  _criarSistemaRastro3D() {
    if (this.espelhar) return; // Apenas a mão principal desenha trilha didática

    const positions = new Float32Array(this.maxVerticesLinha * 3);
    const colors = new Float32Array(this.maxVerticesLinha * 3);

    for (let i = 0; i < this.maxVerticesLinha; i++) {
      const ratio = i / (this.maxVerticesLinha - 1);
      colors[i * 3 + 0] = lerpVal(0.62, 0.94, ratio);
      colors[i * 3 + 1] = lerpVal(0.78, 0.98, ratio);
      colors[i * 3 + 2] = lerpVal(0.90, 1.00, ratio);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      linewidth: 2
    });

    this.linhaRastro = new THREE.Line(geo, mat);
    this.linhaRastro.frustumCulled = false;
    this.linhaRastro.visible = false;
    this.scene.add(this.linhaRastro);

    // Esfera luminosa discreta no ponto focal do traçado
    const cursorGeo = new THREE.SphereGeometry(0.052, 14, 14);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: 0xe6f4fc,
      transparent: true,
      opacity: 0.95
    });
    this.pontoCursorRastro = new THREE.Mesh(cursorGeo, cursorMat);
    this.pontoCursorRastro.visible = false;
    this.scene.add(this.pontoCursorRastro);
  }

  limparRastro() {
    this.pontosRastro = [];
    if (this.linhaRastro) {
      this.linhaRastro.geometry.setDrawRange(0, 0);
      this.linhaRastro.visible = false;
    }
    if (this.pontoCursorRastro) {
      this.pontoCursorRastro.visible = false;
    }
  }

  _atualizarRastro3D() {
    if (
      !this.linhaRastro ||
      !this.rastroAtivo ||
      !this.movimentoAtivo ||
      !this.dedoRastro ||
      !this.gravandoRastro
    ) {
      if (this.linhaRastro && this.linhaRastro.visible) this.limparRastro();
      return;
    }

    const objDedo = this.dedos[this.dedoRastro];
    if (!objDedo || !objDedo.ponta) return;

    this.grupo.updateMatrixWorld(true);
    objDedo.ponta.getWorldPosition(this._vecTemp);

    // Amostragem espacial densa sem descartar o início de J ou Z
    const ultimo = this.pontosRastro[this.pontosRastro.length - 1];
    if (!ultimo || ultimo.distanceToSquared(this._vecTemp) > 0.00004) {
      this.pontosRastro.push(this._vecTemp.clone());
      if (this.pontosRastro.length > this.maxPontosRastro) {
        // Para traçados contínuos longos além de 360 pontos, remove o mais antigo
        if (this.movimentoAtivo !== 'tracar_j' && this.movimentoAtivo !== 'tracar_z') {
          this.pontosRastro.shift();
        } else {
          this.pontosRastro.pop();
        }
      }
    }

    const n = this.pontosRastro.length;
    if (n < 2) return;

    // Para a letra J e curvas contínuas, interpola via Spline Centripeta Catmull-Rom para curvatura fluida perfeita
    let pontosRender = this.pontosRastro;
    if (
      this.movimentoAtivo !== 'tracar_z' &&
      n >= 4 &&
      typeof THREE.CatmullRomCurve3 === 'function'
    ) {
      const curva = new THREE.CatmullRomCurve3(this.pontosRastro, false, 'centripetal', 0.5);
      const numSubdivisoes = Math.min(this.maxVerticesLinha - 1, Math.max(n * 2, 28));
      pontosRender = curva.getPoints(numSubdivisoes);
    }

    const totalV = Math.min(pontosRender.length, this.maxVerticesLinha);
    const posAttr = this.linhaRastro.geometry.attributes.position;
    const colAttr = this.linhaRastro.geometry.attributes.color;

    for (let i = 0; i < totalV; i++) {
      const pt = pontosRender[i];
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);

      const ratio = totalV > 1 ? i / (totalV - 1) : 1;
      colAttr.setXYZ(
        i,
        lerpVal(0.62, 0.96, ratio),
        lerpVal(0.78, 0.99, ratio),
        lerpVal(0.90, 1.00, ratio)
      );
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.linhaRastro.geometry.setDrawRange(0, totalV);
    this.linhaRastro.visible = true;

    if (this.pontoCursorRastro) {
      this.pontoCursorRastro.position.copy(this._vecTemp);
      this.pontoCursorRastro.visible = true;
    }
  }

  // ----------------------------------------------------------
  // setAlvo(nome, rx, ry, rz, midX, distX)
  // ----------------------------------------------------------
  setAlvo(nome, rx = 0, ry = 0, rz = undefined, midX = undefined, distX = undefined) {
    const d = this.dedos[nome];
    if (!d) return;

    d.alvoX = rx;
    d.alvoY = ry;
    if (rz !== undefined) d.alvoZ = rz;

    if (nome === 'polegar') {
      d.alvoMidX = midX !== undefined ? midX : d.alvoX * 0.85;
      d.alvoDistX = 0;
    } else {
      d.alvoMidX = midX !== undefined ? midX : Math.min(d.alvoX * 1.05, 1.72);
      d.alvoDistX = distX !== undefined ? distX : Math.min(d.alvoX * 0.80, 1.38);
    }
  }

  setPulsoAlvo(rx = 0, ry = 0, rz = 0) {
    this.pulso.alvoX = rx;
    this.pulso.alvoY = ry;
    this.pulso.alvoZ = rz;
  }

  // ----------------------------------------------------------
  // aplicarPose(rotacoes3d, movimento, pontaRastro)
  // ----------------------------------------------------------
  aplicarPose(rotacoes3d, movimento = null, pontaRastro = null) {
    if (!rotacoes3d) return;

    const p = rotacoes3d.pulso || { x: 0, y: 0, z: 0 };
    this.setPulsoAlvo(p.x, p.y, p.z);

    const nomesDedos = ['polegar', 'indicador', 'medio', 'anelar', 'mindinho'];
    for (const nome of nomesDedos) {
      const r = rotacoes3d[nome];
      if (r) {
        this.setAlvo(nome, r.x, r.y, r.z, r.midX, r.distX);
      }
    }

    this.movimentoAtivo = movimento || null;
    this.tempoMovimento = 0;
    this.gravandoRastro = false;

    // Define qual ponta de dedo desenha a trilha espacial 3D
    const mapaPontaDefault = {
      tracar_j: 'mindinho',
      tracar_z: 'indicador',
      giro_pulso: 'indicador',
      impulso_cima: 'indicador',
      puxar_x: 'indicador',
      agua_libras: 'indicador',
      nao_abano: 'indicador',
      circular_peito: 'medio',
      obrigado: 'medio'
    };
    this.dedoRastro = pontaRastro || (movimento ? mapaPontaDefault[movimento] || null : null);
    this.limparRastro();
  }

  // ----------------------------------------------------------
  // atualizar(delta)
  // Executa cinemática de mola criticamente amortecida (2ª ordem) + trajetórias espaciais
  // ----------------------------------------------------------
  atualizar(delta) {
    this.tempoGlobal += delta;

    // Frequências naturais (omega) das juntas em cascata (MCP -> PIP -> DIP)
    const omegaBase = 14.5;
    const omegaMid  = 12.8;
    const omegaDist = 11.2;

    // Micro-oscilação orgânica multi-harmônica de servo em standby
    const idleBreath = this.movimentoAtivo
      ? 0
      : Math.sin(this.tempoGlobal * 1.8) * 0.011 + Math.cos(this.tempoGlobal * 0.9) * 0.005;

    for (const nome of Object.keys(this.dedos)) {
      const d = this.dedos[nome];
      const c = d.cascata || 1.0;

      [d.atualX,     d.velX]     = springStep(d.atualX,     d.velX,     d.alvoX + idleBreath * c, omegaBase * c, delta);
      [d.atualMidX,  d.velMidX]  = springStep(d.atualMidX,  d.velMidX,  d.alvoMidX,               omegaMid  * c, delta);
      [d.atualDistX, d.velDistX] = springStep(d.atualDistX, d.velDistX, d.alvoDistX,              omegaDist * c, delta);
      [d.atualY,     d.velY]     = springStep(d.atualY,     d.velY,     d.alvoY,                  omegaBase * c, delta);
      [d.atualZ,     d.velZ]     = springStep(d.atualZ,     d.velZ,     d.alvoZ,                  omegaBase * c, delta);

      if (d.base) {
        d.base.rotation.x = d.atualX;
        d.base.rotation.y = d.atualY;
        d.base.rotation.z = d.atualZ;
      }
      if (d.mid)  d.mid.rotation.x  = d.atualMidX;
      if (d.dist) d.dist.rotation.x = d.atualDistX;
    }

    // Interpola orientação base do pulso com mola de 2ª ordem suave
    [this.pulso.atualX, this.pulso.velX] = springStep(this.pulso.atualX, this.pulso.velX, this.pulso.alvoX, 12.5, delta);
    [this.pulso.atualY, this.pulso.velY] = springStep(this.pulso.atualY, this.pulso.velY, this.pulso.alvoY, 12.5, delta);
    [this.pulso.atualZ, this.pulso.velZ] = springStep(this.pulso.atualZ, this.pulso.velZ, this.pulso.alvoZ, 12.5, delta);

    // Calcula trajetórias espaciais 3D (Posição + Rotação dinâmica de pulso/dedos)
    let modRx = 0, modRy = 0, modRz = 0;
    let modPx = 0, modPy = 0, modPz = 0;
    let omegaTrajetoria = 14.0;

    if (this.movimentoAtivo) {
      this.tempoMovimento += delta;
      const t = this.tempoMovimento;

      switch (this.movimentoAtivo) {
        case 'tracar_j': {
          // Ciclo de 2.50s da letra 'J':
          //  - 0.00s..0.44s: Preparação (dedos fecham em J e mão posiciona no topo da haste sem riscar o rastro)
          //  - 0.44s..1.78s: Traçado único contínuo C1/C2 (haste vertical reta + gancho semicircular suave)
          //  - 1.78s..2.50s: Sustentação final exibindo o J completo desenhado no ar
          const durCicloJ = 2.50;
          const faseJ = t % durCicloJ;

          const xTopo = 0.16;
          const yTopo = 0.28;
          const yInicioArco = -0.06;
          const rxGancho = 0.17;
          const ryGancho = 0.18;
          const thetaMax = 0.92 * Math.PI;
          const sHaste = 0.3952; // Razão exata de comprimento de arco p/ continuidade C1 perfeita

          if (faseJ < 0.44) {
            this.gravandoRastro = false;
            if (this.pontosRastro.length > 0) this.limparRastro();
            omegaTrajetoria = 13.5;
            modPx = xTopo;
            modPy = yTopo;
            modPz = 0.04;
            modRx = 0;
            modRy = 0;
            modRz = 0;
          } else if (faseJ < 1.78) {
            this.gravandoRastro = true;
            omegaTrajetoria = 26.0;

            const u = (faseJ - 0.44) / 1.34;
            // Progressão global suave por cosseno (sem parar entre haste e curva!)
            const s = 0.5 - 0.5 * Math.cos(Math.PI * u);

            if (s <= sHaste) {
              const w = s / sHaste;
              modPx = xTopo;
              modPy = lerpVal(yTopo, yInicioArco, w);
              modPz = 0.04;
              modRx = 0;
              modRy = 0;
              modRz = 0;
            } else {
              const q = (s - sHaste) / (1 - sHaste);
              const theta = q * thetaMax;
              // Fator monotônico C2 (derivada zero em theta=0 e theta=pi, sem reversão!)
              const k = 0.5 * (1 - Math.cos(theta));

              modPx = (xTopo - rxGancho) + rxGancho * Math.cos(theta);
              modPy = yInicioArco - ryGancho * Math.sin(theta);
              modPz = 0.04 + 0.05 * Math.sin(theta);
              modRy = k * 0.22;
              modRz = k * 0.05;
              modRx = -k * 0.06;
            }
          } else {
            this.gravandoRastro = true;
            omegaTrajetoria = 22.0;
            const kFim = 0.5 * (1 - Math.cos(thetaMax));
            modPx = (xTopo - rxGancho) + rxGancho * Math.cos(thetaMax);
            modPy = yInicioArco - ryGancho * Math.sin(thetaMax);
            modPz = 0.04 + 0.05 * Math.sin(thetaMax);
            modRy = kFim * 0.22;
            modRz = kFim * 0.05;
            modRx = -kFim * 0.06;
          }
          break;
        }

        case 'tracar_z': {
          // Ciclo de 2.75s da letra 'Z':
          //  - 0.00s..0.44s: Preparação (dedos formam Z e mão vai ao topo esquerdo sem riscar o rastro)
          //  - 0.44s..0.94s: Reta horizontal superior
          //  - 0.94s..1.56s: Reta diagonal descendente
          //  - 1.56s..2.06s: Reta horizontal inferior
          //  - 2.06s..2.75s: Sustentação final exibindo o Z completo sem apagar o início
          const durCicloZ = 2.75;
          const faseZ = t % durCicloZ;

          if (faseZ < 0.44) {
            this.gravandoRastro = false;
            if (this.pontosRastro.length > 0) this.limparRastro();
            omegaTrajetoria = 13.5;
            modPx = -0.28;
            modPy = 0.24;
            modPz = 0.08;
            modRz = 0.05;
            modRx = 0;
          } else if (faseZ < 0.94) {
            this.gravandoRastro = true;
            omegaTrajetoria = 28.0;
            const p = Easing.easeInOutCubic((faseZ - 0.44) / 0.50);
            modPx = lerpVal(-0.28, 0.28, p);
            modPy = 0.24;
            modPz = 0.08;
            modRz = lerpVal(0.05, -0.05, p);
          } else if (faseZ < 1.56) {
            this.gravandoRastro = true;
            omegaTrajetoria = 28.0;
            const p = Easing.easeInOutCubic((faseZ - 0.94) / 0.62);
            modPx = lerpVal(0.28, -0.28, p);
            modPy = lerpVal(0.24, -0.22, p);
            modPz = 0.08;
            modRz = lerpVal(-0.05, 0.06, p);
            modRx = lerpVal(0.0, 0.14, p);
          } else if (faseZ < 2.06) {
            this.gravandoRastro = true;
            omegaTrajetoria = 28.0;
            const p = Easing.easeInOutCubic((faseZ - 1.56) / 0.50);
            modPx = lerpVal(-0.28, 0.28, p);
            modPy = -0.22;
            modPz = 0.08;
            modRz = lerpVal(0.06, -0.05, p);
            modRx = 0.14;
          } else {
            this.gravandoRastro = true;
            omegaTrajetoria = 22.0;
            modPx = 0.28;
            modPy = -0.22;
            modPz = 0.08;
            modRz = -0.05;
            modRx = 0.14;
          }
          break;
        }

        case 'giro_pulso': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          modRy = Math.sin(ts * 5.2) * 0.52;
          modRz = Math.cos(ts * 5.2) * 0.18;
          modRx = Math.sin(ts * 5.2) * 0.12;
          break;
        }

        case 'impulso_cima': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          const pulsoK = Math.abs(Math.sin(ts * 4.6));
          modPy = pulsoK * 0.20;
          modRx = -pulsoK * 0.24;
          break;
        }

        case 'puxar_x': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          const puxada = Math.sin(ts * 4.5);
          modPz = puxada * 0.18;
          modPx = -puxada * 0.10;
          modRx = Math.max(0, puxada) * 0.15;
          if (this.dedos.indicador) {
            this.dedos.indicador.mid.rotation.x = this.dedos.indicador.atualMidX + Math.max(0, puxada) * 0.22;
          }
          break;
        }

        case 'agua_libras': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          const cicloAgua = (ts * 4.2) % (Math.PI * 2);
          const batidaDupla = cicloAgua < Math.PI * 1.35 ? Math.abs(Math.sin(cicloAgua * 2.0)) : 0;
          if (this.dedos.indicador && this.dedos.indicador.base) {
            this.dedos.indicador.base.rotation.x = this.dedos.indicador.atualX + batidaDupla * 0.58;
            this.dedos.indicador.mid.rotation.x  = this.dedos.indicador.atualMidX + batidaDupla * 0.25;
          }
          break;
        }

        case 'sim_aceno': {
          this.gravandoRastro = false;
          modRx = Math.sin(t * 5.8) * 0.45;
          modPy = -Math.sin(t * 5.8) * 0.05;
          break;
        }

        case 'nao_abano': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          modRz = Math.sin(ts * 7.8) * 0.36;
          modPx = -Math.sin(ts * 7.8) * 0.06;
          break;
        }

        case 'obrigado': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          const cicloOb = (ts * 2.4) % (Math.PI * 2);
          const avanco = (1 - Math.cos(cicloOb)) * 0.5;
          modRx = avanco * 0.42;
          modPz = avanco * 0.24;
          modPy = 0.12 - avanco * 0.16;
          break;
        }

        case 'ajuda': {
          this.gravandoRastro = false;
          const avancoAj = (1 - Math.cos(t * 3.8)) * 0.5;
          modPz = avancoAj * 0.26;
          modPy = avancoAj * 0.16;
          break;
        }

        case 'comida_libras': {
          this.gravandoRastro = false;
          const toqueBoca = Math.sin(t * 5.6);
          modRx = toqueBoca * 0.30;
          modPy = toqueBoca * 0.12;
          modPz = -toqueBoca * 0.10;
          break;
        }

        case 'circular_peito': {
          this.gravandoRastro = t >= 0.40;
          const ts = Math.max(0, t - 0.40);
          modPx = Math.cos(ts * 4.2) * 0.20;
          modPy = Math.sin(ts * 4.2) * 0.20;
          modRz = -Math.cos(ts * 4.2) * 0.15;
          break;
        }

        case 'oscilar_pulso':
        case 'alerta_duplo':
        case 'perigo': {
          this.gravandoRastro = false;
          modRz = Math.sin(t * 7.2) * 0.30;
          modPy = Math.abs(Math.cos(t * 7.2)) * 0.06;
          break;
        }
      }
    } else {
      this.gravandoRastro = false;
      // Respiração mecânica multi-harmônica suave quando em standby
      modPy = Math.sin(this.tempoGlobal * 1.6) * 0.024;
      modRx = Math.cos(this.tempoGlobal * 1.6) * 0.018;
    }

    // Filtra a translação e rotação dinâmica com mola de 2ª ordem para eliminar saltos bruscos
    const tr = this.trajetoria;
    [tr.px, tr.vpx] = springStep(tr.px, tr.vpx, modPx, omegaTrajetoria, delta);
    [tr.py, tr.vpy] = springStep(tr.py, tr.vpy, modPy, omegaTrajetoria, delta);
    [tr.pz, tr.vpz] = springStep(tr.pz, tr.vpz, modPz, omegaTrajetoria, delta);
    [tr.rx, tr.vrx] = springStep(tr.rx, tr.vrx, modRx, omegaTrajetoria, delta);
    [tr.ry, tr.vry] = springStep(tr.ry, tr.vry, modRy, omegaTrajetoria, delta);
    [tr.rz, tr.vrz] = springStep(tr.rz, tr.vrz, modRz, omegaTrajetoria, delta);

    const totalRx = this.pulso.atualX + tr.rx;
    const totalRy = this.pulso.atualY + tr.ry;
    const totalRz = this.pulso.atualZ + tr.rz;

    // 1. Articulação própria do pulso (gira a mão em torno do pivô esférico no carpo)
    this.grupoPulso.rotation.set(totalRx, totalRy, totalRz);

    // 2. Anel Cardânico Intermediário acompanha 50% da angulação (cinemática de junta universal)
    if (this.anelCardanIntermediario) {
      this.anelCardanIntermediario.rotation.set(
        totalRx * 0.5,
        totalRy * 0.35,
        totalRz * 0.5
      );
    }

    // 3. Pistões Hidráulicos do Pulso comprimem e estendem dinamicamente conforme a inclinação
    if (this.hastesPistao && this.hastesPistao.length > 0) {
      for (const p of this.hastesPistao) {
        const curso = -p.pz * Math.sin(totalRx) * 0.42 + p.px * Math.sin(totalRz) * 0.28;
        p.mesh.position.y = p.baseY + curso;
        p.mesh.rotation.x = totalRx * 0.26;
        p.mesh.rotation.z = totalRz * 0.26;
      }
    }

    // 4. Translação espacial e acompanhamento suave do antebraço
    if (this.grupoAntebraco) {
      this.grupoAntebraco.position.set(tr.px, tr.py, tr.pz);
      this.grupoAntebraco.rotation.set(
        tr.rx * 0.12,
        tr.ry * 0.14,
        tr.rz * 0.12
      );
    }

    // Atualiza trilha espacial 3D se houver movimento ativo e preparação concluída
    this._atualizarRastro3D();
  }

  // ----------------------------------------------------------
  // posicaoNeutra()
  // ----------------------------------------------------------
  posicaoNeutra() {
    this.movimentoAtivo = null;
    this.gravandoRastro = false;
    this.dedoRastro = null;
    this.tempoMovimento = 0;
    this.limparRastro();

    this.setPulsoAlvo(0, 0, 0);
    this.setAlvo('polegar',   0.05, 0.20, -1.05, 0.05, 0);
    this.setAlvo('indicador', 0.06, 0.0,  -0.04, 0.06, 0.04);
    this.setAlvo('medio',     0.06, 0.0,   0.00, 0.06, 0.04);
    this.setAlvo('anelar',    0.06, 0.0,   0.03, 0.06, 0.04);
    this.setAlvo('mindinho',  0.06, 0.0,   0.09, 0.06, 0.04);
  }

  // ----------------------------------------------------------
  // destruir() — Libera 100% dos recursos WebGL da mão, texturas e rastro
  // ----------------------------------------------------------
  destruir() {
    if (this.linhaRastro) {
      if (this.scene) this.scene.remove(this.linhaRastro);
      if (this.linhaRastro.geometry) this.linhaRastro.geometry.dispose();
      if (this.linhaRastro.material) this.linhaRastro.material.dispose();
      this.linhaRastro = null;
    }

    if (this.pontoCursorRastro) {
      if (this.scene) this.scene.remove(this.pontoCursorRastro);
      if (this.pontoCursorRastro.geometry) this.pontoCursorRastro.geometry.dispose();
      if (this.pontoCursorRastro.material) this.pontoCursorRastro.material.dispose();
      this.pontoCursorRastro = null;
    }

    if (this._texturasProcedurais && this._texturasProcedurais.length > 0) {
      for (const tex of this._texturasProcedurais) {
        if (tex && tex.dispose) tex.dispose();
      }
      this._texturasProcedurais = [];
    }

    if (!this.grupo) return;
    if (this.scene) this.scene.remove(this.grupo);

    this.grupo.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m && m.dispose && m.dispose());
        } else if (obj.material.dispose) {
          obj.material.dispose();
        }
      }
    });

    this.grupo = null;
    this.grupoAntebraco = null;
    this.anelCardanIntermediario = null;
    this.grupoPulso = null;
    this.hastesPistao = [];
    this.dedos = {};
  }
}

// ============================================================
// 3. CLASSE: LibraHand3D (Gerenciador de Cena, Órbita e Ciclo de Vida)
// ============================================================
class LibraHand3D {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.clock = null;
    this.rafId = null;
    this.maoDir = null;
    this.maoEsq = null;
    this.particulas = null;
    this.anelHoloInterno = null;
    this.modoDuasMaos = false;
    this.pronto = false;

    // Estado de órbita esférica da câmera (afastamento calibrado p/ nunca cortar a ponta dos dedos)
    this.autoRotando = true;
    this.orbitaTheta = 0;
    this.orbitaPhi = 0.14;
    this.orbitaRaioPadrao = containerId === 'hand3d-container' ? 6.20 : 5.75;
    this.orbitaRaio = this.orbitaRaioPadrao;
    this.arrastando = false;
    this.ultimoMouseX = 0;
    this.ultimoMouseY = 0;

    // Referências para cleanup e controle de redimensionamento sem thrashing no mobile
    this.ehMobile =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 980px), (pointer: coarse)').matches;
    this._lastW = 0;
    this._lastH = 0;
    this._resizeObserver = null;
    this._onResize = null;
    this._onVisibilityChange = null;
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp = null;
    this._onWheel = null;
  }

  setUp() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn('[LibraHand3D] Container não encontrado:', this.containerId);
      return;
    }

    this.clock = new THREE.Clock();

    // ── RENDERER WEBGL DE ALTA EFICIÊNCIA (Otimizado p/ Mobile sem queda de FPS no scroll) ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.ehMobile,
      alpha: true,
      powerPreference: 'high-performance'
    });
    const maxDpr = this.ehMobile ? 1.3 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.shadowMap.enabled = !this.ehMobile;
    if (!this.ehMobile) {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    this.renderer.domElement.style.cssText =
      'width:100%;height:100%;display:block;cursor:grab;touch-action:none;outline:none;';
    this.container.appendChild(this.renderer.domElement);

    // ── CENA & ATMOSFERA DE LABORATÓRIO ESCURO ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050505, 0.042);

    // ── CÂMERA ──
    const w = this.container.clientWidth || 480;
    const h = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(39, w / h, 0.1, 80);
    this._atualizarPosicaoCamera();
    this._resize();

    // ── ILUMINAÇÃO DE ESTÚDIO MINIMALISTA (ESTILO KEYNOTE APPLE / SPACEX) ──
    const hemiLight = new THREE.HemisphereLight(0xf5f7fa, 0x08090c, 0.85);
    this.scene.add(hemiLight);

    const luzPrincipal = new THREE.DirectionalLight(0xffffff, 2.05);
    luzPrincipal.position.set(3.4, 6.0, 4.8);
    luzPrincipal.castShadow = !this.ehMobile;
    if (!this.ehMobile) {
      luzPrincipal.shadow.mapSize.set(1024, 1024);
      luzPrincipal.shadow.camera.near = 0.5;
      luzPrincipal.shadow.camera.far = 16;
    }
    this.scene.add(luzPrincipal);

    const luzRimPrata = new THREE.PointLight(0xc2d6e3, 1.45, 14);
    luzRimPrata.position.set(-4.0, 2.2, 2.4);
    this.scene.add(luzRimPrata);

    const luzContraFria = new THREE.PointLight(0x6e8798, 0.85, 14);
    luzContraFria.position.set(3.6, -0.5, -2.8);
    this.scene.add(luzContraFria);

    // ── PLATAFORMA DE CALIBRAÇÃO & PARTÍCULAS DE LABORATÓRIO ──
    this._criarBaseHolografica();
    this._criarParticulas();

    // ── MÃO DIREITA (Principal) ──
    this.maoDir = new MaoRobotica(this.scene, 0, false);
    this.maoDir.criar();
    this.maoDir.posicaoNeutra();

    // ── MÃO ESQUERDA (Pré-alocada em pool p/ zero alocação em tempo real) ──
    this.maoEsq = new MaoRobotica(this.scene, -1.32, true);
    this.maoEsq.criar();
    this.maoEsq.posicaoNeutra();
    this.maoEsq.grupo.visible = false;

    this._registrarEventos();

    this.pronto = true;
    this._loop();
  }

  _criarBaseHolografica() {
    if (!this.ehMobile) {
      const planoSombra = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 16),
        new THREE.ShadowMaterial({ opacity: 0.32 })
      );
      planoSombra.rotation.x = -Math.PI / 2;
      planoSombra.position.y = -1.36;
      planoSombra.receiveShadow = true;
      this.scene.add(planoSombra);
    }

    // Anel externo de calibração (prata translúcido muito subtil)
    const anelExterno = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 0.96, 64),
      new THREE.MeshBasicMaterial({
        color: 0x9bb4c4,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide
      })
    );
    anelExterno.rotation.x = -Math.PI / 2;
    anelExterno.position.y = -1.35;
    this.scene.add(anelExterno);

    // Anel interno técnico segmentado
    this.anelHoloInterno = new THREE.Mesh(
      new THREE.RingGeometry(0.63, 0.65, 32, 1, 0, Math.PI * 1.65),
      new THREE.MeshBasicMaterial({
        color: 0xc8dce8,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide
      })
    );
    this.anelHoloInterno.rotation.x = -Math.PI / 2;
    this.anelHoloInterno.position.y = -1.345;
    this.scene.add(this.anelHoloInterno);
  }

  _criarParticulas() {
    const count = this.ehMobile ? 32 : 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 9 - 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xa8c0ce,
      size: 0.032,
      transparent: true,
      opacity: 0.22
    });

    this.particulas = new THREE.Points(geo, mat);
    this.scene.add(this.particulas);
  }

  _registrarEventos() {
    const dom = this.renderer.domElement;

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize, { passive: true });

    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.container);
    }

    // Page Visibility API: pausa total da GPU quando a aba está em 2º plano
    this._onVisibilityChange = () => {
      if (!this.pronto) return;
      if (document.hidden) {
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
      } else {
        if (this.clock) this.clock.getDelta(); // descarta delta acumulado
        if (!this.rafId) this._loop();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Controles de Órbita (Pointer Events unificados p/ Mouse e Touch)
    this._onPointerDown = (e) => {
      this.arrastando = true;
      this.ultimoMouseX = e.clientX;
      this.ultimoMouseY = e.clientY;
      dom.style.cursor = 'grabbing';
    };

    this._onPointerMove = (e) => {
      if (!this.arrastando) return;
      const dx = e.clientX - this.ultimoMouseX;
      const dy = e.clientY - this.ultimoMouseY;
      this.ultimoMouseX = e.clientX;
      this.ultimoMouseY = e.clientY;

      this.orbitaTheta -= dx * 0.008;
      this.orbitaPhi = Math.max(-0.45, Math.min(0.85, this.orbitaPhi + dy * 0.006));
      this._atualizarPosicaoCamera();
    };

    this._onPointerUp = () => {
      if (!this.arrastando) return;
      this.arrastando = false;
      if (dom) dom.style.cursor = 'grab';
    };

    this._onWheel = (e) => {
      e.preventDefault();
      this.orbitaRaio = Math.max(3.2, Math.min(9.5, this.orbitaRaio + e.deltaY * 0.003));
      this._atualizarPosicaoCamera();
    };

    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp, { passive: true });
    dom.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _atualizarPosicaoCamera() {
    if (!this.camera) return;
    const r = this.orbitaRaio;
    const phi = this.orbitaPhi;
    const th = this.orbitaTheta;

    this.camera.position.x = r * Math.sin(th) * Math.cos(phi);
    this.camera.position.y = 0.64 + r * Math.sin(phi);
    this.camera.position.z = r * Math.cos(th) * Math.cos(phi);
    this.camera.lookAt(0, 0.56, 0);
  }

  _loop() {
    if (!this.pronto || document.hidden) {
      this.rafId = null;
      return;
    }

    this.rafId = requestAnimationFrame(() => this._loop());

    const delta = Math.min(this.clock.getDelta(), 0.1);

    if (this.maoDir) this.maoDir.atualizar(delta);
    if (this.maoEsq && this.maoEsq.grupo && this.maoEsq.grupo.visible) {
      this.maoEsq.atualizar(delta);
    }

    if (this.particulas) {
      this.particulas.rotation.y += delta * 0.025;
    }
    if (this.anelHoloInterno) {
      this.anelHoloInterno.rotation.z -= delta * 0.45;
    }

    // Pausa suavemente a rotação orbital durante traçados espaciais (J, Z) para leitura perfeita
    const tracandoNoEspaco =
      this.maoDir &&
      (this.maoDir.movimentoAtivo === 'tracar_j' || this.maoDir.movimentoAtivo === 'tracar_z');

    if (this.autoRotando && !this.arrastando && !tracandoNoEspaco) {
      this.orbitaTheta += delta * 0.24;
      this._atualizarPosicaoCamera();
    }

    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 480;
    const h = this.container.clientHeight || 400;
    if (Math.abs(w - this._lastW) <= 1 && Math.abs(h - this._lastH) <= 1) return;
    this._lastW = w;
    this._lastH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  animarLetra(rotacoes3d, movimento = null, pontaRastro = null) {
    this._ativarUmaMao();
    if (!rotacoes3d || !this.maoDir) return;

    // Se a letra exige traçado espacial (J ou Z), alinha a câmera frontalmente para leitura clara
    if (movimento === 'tracar_j' || movimento === 'tracar_z') {
      this.orbitaTheta = 0;
      this.orbitaPhi = 0.14;
      this._atualizarPosicaoCamera();
    }

    this.maoDir.aplicarPose(rotacoes3d, movimento, pontaRastro);
  }

  animarPalavra(dadosPalavra) {
    if (!dadosPalavra) return;

    if (dadosPalavra.duas_maos) {
      this._ativarDuasMaos();
    } else {
      this._ativarUmaMao();
    }

    const mov = dadosPalavra.movimento || null;
    const ponta = dadosPalavra.pontaRastro || null;

    if (this.maoDir && dadosPalavra.mao_direita && dadosPalavra.mao_direita.rotacoes3d) {
      this.maoDir.aplicarPose(dadosPalavra.mao_direita.rotacoes3d, mov, ponta);
    }

    if (this.maoEsq && dadosPalavra.duas_maos && dadosPalavra.mao_esquerda && dadosPalavra.mao_esquerda.rotacoes3d) {
      this.maoEsq.aplicarPose(dadosPalavra.mao_esquerda.rotacoes3d, mov, null);
    }
  }

  posicaoNeutra() {
    if (this.maoDir) this.maoDir.posicaoNeutra();
    if (this.maoEsq) this.maoEsq.posicaoNeutra();
  }

  _ativarUmaMao() {
    if (!this.modoDuasMaos) return;
    this.modoDuasMaos = false;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 0 }, 450);
    }
    if (this.maoEsq && this.maoEsq.grupo) {
      this.maoEsq.posicaoNeutra();
      this.maoEsq.grupo.visible = false;
    }
  }

  _ativarDuasMaos() {
    this.modoDuasMaos = true;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 1.25 }, 450);
    }
    if (this.maoEsq && this.maoEsq.grupo) {
      this.maoEsq.grupo.visible = true;
      smoothLerp(this.maoEsq.grupo.position, { x: -1.25 }, 450);
    }
  }

  toggleRotacao() {
    this.autoRotando = !this.autoRotando;
    return this.autoRotando;
  }

  resetarCamera() {
    this.autoRotando = false;
    this.orbitaTheta = 0;
    this.orbitaPhi = 0.14;
    this.orbitaRaio = this.orbitaRaioPadrao || 6.20;
    const r = this.orbitaRaio;

    if (this.camera) {
      smoothLerp(
        this.camera.position,
        {
          x: 0,
          y: 0.64 + r * Math.sin(0.14),
          z: r * Math.cos(0.14)
        },
        520,
        Easing.easeOutCubic,
        () => {
          if (this.camera) this.camera.lookAt(0, 0.56, 0);
        }
      );
    }
  }

  destruir() {
    this.pronto = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._onPointerMove) window.removeEventListener('pointermove', this._onPointerMove);
    if (this._onPointerUp) window.removeEventListener('pointerup', this._onPointerUp);

    if (this.renderer && this.renderer.domElement) {
      const dom = this.renderer.domElement;
      if (this._onPointerDown) dom.removeEventListener('pointerdown', this._onPointerDown);
      if (this._onWheel) dom.removeEventListener('wheel', this._onWheel);
    }

    if (this.maoDir) {
      this.maoDir.destruir();
      this.maoDir = null;
    }
    if (this.maoEsq) {
      this.maoEsq.destruir();
      this.maoEsq = null;
    }

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m && m.dispose && m.dispose());
          } else if (obj.material.dispose) {
            obj.material.dispose();
          }
        }
      });
      this.scene = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      this.renderer = null;
    }

    this.camera = null;
    this.container = null;
  }
}

// Exposição global limpa
window.smoothLerp = smoothLerp;
window.MaoRobotica = MaoRobotica;
window.LibraHand3D = LibraHand3D;
var libraHand3D = null;
