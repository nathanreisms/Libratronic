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

// Interpolação linear simples com clamp
function lerpVal(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

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

    // Grupo do pulso (controla orientação anatômica e trajetórias espaciais)
    this.grupoPulso = new THREE.Group();
    this.grupo.add(this.grupoPulso);

    this.dedos = {};
    this.pulso = {
      alvoX: 0, alvoY: 0, alvoZ: 0,
      atualX: 0, atualY: 0, atualZ: 0
    };

    this.movimentoAtivo = null;
    this.tempoMovimento = 0;
    this.tempoGlobal = Math.random() * 10;

    // Rastro Holográfico 3D (Motion Trail para J, Z e sinais dinâmicos)
    this.rastroAtivo = true;
    this.dedoRastro = null;
    this.maxPontosRastro = 44;
    this.pontosRastro = [];
    this.linhaRastro = null;
    this.pontoCursorRastro = null;
    this._vecTemp = new THREE.Vector3();

    this._inicializarMateriais();
  }

  _inicializarMateriais() {
    // Cerâmica Aeroespacial Branca Acetinada (Carcaça externa)
    this.matBranco = new THREE.MeshStandardMaterial({
      color: 0xeaf4fc,
      roughness: 0.26,
      metalness: 0.18
    });

    // Liga de Titânio Anodizado Escuro (Juntas, rolamentos e atuadores)
    this.matMetal = new THREE.MeshStandardMaterial({
      color: 0x4b6b85,
      roughness: 0.24,
      metalness: 0.86
    });

    // Cromo Técnico Polido (Hastes de pistões e anéis de precisão)
    this.matCromo = new THREE.MeshStandardMaterial({
      color: 0xc8e0f4,
      roughness: 0.14,
      metalness: 0.92
    });

    // Compósito de Fibra de Carbono Azul-Noturno (Chassi interno e pads palmares)
    this.matDetalhe = new THREE.MeshStandardMaterial({
      color: 0x16293a,
      roughness: 0.46,
      metalness: 0.42
    });

    // Emissor LED Neon Ciano (Sensores táteis, núcleo palmar e anel de pulso)
    this.matNeon = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      roughness: 0.12,
      metalness: 0.10,
      emissive: new THREE.Color(0x00b8e6),
      emissiveIntensity: 0.95
    });
  }

  criar() {
    this.grupo.position.set(this.posicaoX, -0.18, 0);
    if (this.espelhar) {
      this.grupo.scale.x = -1;
    }

    this._criarPulsoEAntebraco();
    this._criarPalmaBionica();

    // 4 dedos principais: (nome, ox, oy, raio, [prox, med, dist], incZ)
    this._criarDedo('mindinho',  -0.55, 0.95, 0.088, [0.48, 0.33, 0.25],  0.09);
    this._criarDedo('anelar',    -0.19, 1.02, 0.098, [0.58, 0.39, 0.27],  0.03);
    this._criarDedo('medio',      0.17, 1.06, 0.105, [0.64, 0.42, 0.29],  0.00);
    this._criarDedo('indicador',  0.53, 1.00, 0.100, [0.57, 0.38, 0.27], -0.04);

    this._criarPolegarOpositor();
    this._criarSistemaRastro3D();

    this.scene.add(this.grupo);
  }

  // ----------------------------------------------------------
  // _criarPulsoEAntebraco()
  // Articulação cardânica de pulso + antebraço com pistões duplos
  // ----------------------------------------------------------
  _criarPulsoEAntebraco() {
    // Núcleo esférico central do pulso
    const esferaPulso = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 20, 16),
      this.matMetal
    );
    esferaPulso.position.y = -0.05;
    this.grupoPulso.add(esferaPulso);

    // Anel cardânico metálico ao redor da junta do pulso
    const anelCardan = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.028, 12, 32),
      this.matCromo
    );
    anelCardan.position.y = -0.05;
    this.grupoPulso.add(anelCardan);

    // Colar superior chanfrado de transição pulso-antebraço
    const colarSup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.38, 0.22, 20),
      this.matBranco
    );
    colarSup.position.y = -0.16;
    colarSup.castShadow = true;
    this.grupoPulso.add(colarSup);

    // Anel LED luminoso de telemetria no pulso
    const anelLed = new THREE.Mesh(
      new THREE.TorusGeometry(0.425, 0.022, 12, 36),
      this.matNeon
    );
    anelLed.rotation.x = Math.PI / 2;
    anelLed.position.y = -0.27;
    this.grupoPulso.add(anelLed);

    // Carcaça principal do antebraço biônico
    const antebraco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.39, 0.48, 0.54, 20),
      this.matBranco
    );
    antebraco.position.y = -0.55;
    antebraco.castShadow = true;
    antebraco.receiveShadow = true;
    this.grupoPulso.add(antebraco);

    // Recortes técnicos em fibra escura no antebraço
    const placaAntebraco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.405, 0.46, 0.34, 16, 1, false, -0.55, 1.1),
      this.matDetalhe
    );
    placaAntebraco.position.y = -0.54;
    this.grupoPulso.add(placaAntebraco);

    // 4 Pistões hidráulicos (2 frontais e 2 dorsais) com camisa e haste cromada
    const offsetsPistao = [
      [-0.33, 0.14], [0.33, 0.14],
      [-0.31, -0.14], [0.31, -0.14]
    ];
    for (const [px, pz] of offsetsPistao) {
      const camisa = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.052, 0.34, 10),
        this.matMetal
      );
      camisa.position.set(px, -0.46, pz);
      this.grupoPulso.add(camisa);

      const haste = new THREE.Mesh(
        new THREE.CylinderGeometry(0.030, 0.030, 0.32, 10),
        this.matCromo
      );
      haste.position.set(px, -0.22, pz);
      this.grupoPulso.add(haste);
    }

    // Flange metálica de fechamento inferior do antebraço
    const anelBase = new THREE.Mesh(
      new THREE.TorusGeometry(0.475, 0.038, 12, 28),
      this.matMetal
    );
    anelBase.rotation.x = Math.PI / 2;
    anelBase.position.y = -0.81;
    this.grupoPulso.add(anelBase);
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
      bevelSegments: 4
    };

    const geoPalma = new THREE.ExtrudeGeometry(shapePalma, extrudeSettings);
    geoPalma.center();

    const malhaPalma = new THREE.Mesh(geoPalma, this.matBranco);
    malhaPalma.position.set(0, 0.47, 0);
    malhaPalma.castShadow = true;
    malhaPalma.receiveShadow = true;
    this.grupoPulso.add(malhaPalma);

    // Chassi palmar interno segmentado (almofadas táteis de aderência)
    const padSup = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.28, 0.045),
      this.matDetalhe
    );
    padSup.position.set(0, 0.69, 0.145);
    this.grupoPulso.add(padSup);

    const padInfEsq = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.34, 0.045),
      this.matDetalhe
    );
    padInfEsq.position.set(-0.30, 0.30, 0.142);
    this.grupoPulso.add(padInfEsq);

    // Eminência tenar (músculo mecânico opositor na base do polegar)
    const tenar = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 14),
      this.matDetalhe
    );
    tenar.scale.set(1.15, 1.38, 0.76);
    tenar.position.set(0.46, 0.26, 0.11);
    this.grupoPulso.add(tenar);

    // Blindagem dorsal e nervuras metacarpais (4 tendões mecânicos no dorso)
    const placaDorsal = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.62, 0.045),
      this.matDetalhe
    );
    placaDorsal.position.set(0, 0.46, -0.145);
    this.grupoPulso.add(placaDorsal);

    const posMetacarpos = [-0.50, -0.17, 0.17, 0.50];
    for (const mx of posMetacarpos) {
      const tendaoDorsal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.028, 0.66, 8),
        this.matCromo
      );
      tendaoDorsal.position.set(mx * 0.92, 0.52, -0.165);
      tendaoDorsal.rotation.z = -mx * 0.10;
      this.grupoPulso.add(tendaoDorsal);
    }

    // Núcleo Energético Biônico (Palma e Dorso)
    const nucleoAnelGeo = new THREE.RingGeometry(0.105, 0.165, 28);
    const nucleoCentroGeo = new THREE.CircleGeometry(0.075, 24);

    const nucleoFrente = new THREE.Mesh(nucleoAnelGeo, this.matNeon);
    nucleoFrente.position.set(-0.02, 0.46, 0.172);
    this.grupoPulso.add(nucleoFrente);

    const centroFrente = new THREE.Mesh(nucleoCentroGeo, this.matNeon);
    centroFrente.position.set(-0.02, 0.46, 0.171);
    this.grupoPulso.add(centroFrente);

    const nucleoDorso = new THREE.Mesh(nucleoAnelGeo, this.matNeon);
    nucleoDorso.rotation.y = Math.PI;
    nucleoDorso.position.set(0, 0.46, -0.172);
    this.grupoPulso.add(nucleoDorso);

    // Knuckles (Juntas Metacarpofalangeanas MCP com anel duplo)
    const posKnuckles = [
      [-0.55, 0.93, 0.088],
      [-0.19, 1.00, 0.098],
      [ 0.17, 1.04, 0.105],
      [ 0.53, 0.98, 0.100]
    ];
    for (const [kx, ky, kr] of posKnuckles) {
      const knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(kr * 1.15, 14, 12),
        this.matMetal
      );
      knuckle.position.set(kx, ky, 0);
      this.grupoPulso.add(knuckle);

      const pinoKnuckle = new THREE.Mesh(
        new THREE.CylinderGeometry(kr * 0.42, kr * 0.42, kr * 2.4, 10),
        this.matCromo
      );
      pinoKnuckle.rotation.z = Math.PI / 2;
      pinoKnuckle.position.set(kx, ky, 0);
      this.grupoPulso.add(pinoKnuckle);
    }
  }

  // ----------------------------------------------------------
  // _criarDedo(nome, ox, oy, raio, comps, incZ)
  // Cria um dedo com 3 falanges articuladas e ponteira de rastreio
  // ----------------------------------------------------------
  _criarDedo(nome, ox, oy, raio, comps, incZ = 0) {
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
      alvoX: 0.05, alvoMidX: 0.05, alvoDistX: 0.04,
      alvoY: 0,    alvoZ: incZ,
      atualX: 0.05, atualMidX: 0.05, atualDistX: 0.04,
      atualY: 0,    atualZ: incZ
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
      alvoX: 0.05, alvoMidX: 0.05, alvoDistX: 0,
      alvoY: 0.20, alvoZ: -1.05,
      atualX: 0.05, atualMidX: 0.05, atualDistX: 0,
      atualY: 0.20, atualZ: -1.05
    };
  }

  // ----------------------------------------------------------
  // _criarSegmentoFalange(raio, altura, comPonta)
  // ----------------------------------------------------------
  _criarSegmentoFalange(raio, altura, comPonta) {
    const grupo = new THREE.Group();

    // Carcaça estrutural cônica-cilíndrica
    const cilGeo = new THREE.CylinderGeometry(raio * 0.87, raio, altura, 16, 1);
    const cil = new THREE.Mesh(cilGeo, this.matBranco);
    cil.position.y = altura / 2;
    cil.castShadow = true;
    cil.receiveShadow = true;
    grupo.add(cil);

    // Escudo dorsal chanfrado (placa de blindagem traseira do dedo -Z)
    const escudoGeo = new THREE.BoxGeometry(raio * 1.35, altura * 0.72, raio * 0.32);
    const escudo = new THREE.Mesh(escudoGeo, this.matBranco);
    escudo.position.set(0, altura * 0.52, -raio * 0.78);
    grupo.add(escudo);

    // Almofada palmar interna de aderência (+Z)
    const padGeo = new THREE.BoxGeometry(raio * 1.38, altura * 0.64, raio * 0.34);
    const pad = new THREE.Mesh(padGeo, this.matDetalhe);
    pad.position.set(0, altura * 0.50, raio * 0.80);
    grupo.add(pad);

    // Anel cromado técnico de tensão
    const anelGeo = new THREE.CylinderGeometry(raio * 0.96, raio * 0.96, altura * 0.09, 14);
    const anel = new THREE.Mesh(anelGeo, this.matCromo);
    anel.position.y = altura * 0.20;
    grupo.add(anel);

    if (comPonta) {
      // Cúpula hemisférica anatômica na extremidade distal
      const cupolaGeo = new THREE.SphereGeometry(
        raio * 0.87, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2
      );
      const cupola = new THREE.Mesh(cupolaGeo, this.matBranco);
      cupola.position.y = altura;
      grupo.add(cupola);

      // Placa ungueal biônica (unha técnica metálica no dorso da ponta)
      const unhaGeo = new THREE.BoxGeometry(raio * 1.10, altura * 0.42, raio * 0.18);
      const unha = new THREE.Mesh(unhaGeo, this.matMetal);
      unha.position.set(0, altura * 0.82, -raio * 0.76);
      unha.rotation.x = 0.14;
      grupo.add(unha);

      // Sensor óptico-tátil LED neon na polpa digital (+Z)
      const sensorGeo = new THREE.SphereGeometry(raio * 0.46, 12, 10);
      const sensor = new THREE.Mesh(sensorGeo, this.matNeon);
      sensor.scale.set(1.0, 1.25, 0.46);
      sensor.position.set(0, altura * 0.78, raio * 0.79);
      grupo.add(sensor);
    }

    return grupo;
  }

  // ----------------------------------------------------------
  // _adicionarJuntaMecanica(grupoJunta, raio)
  // ----------------------------------------------------------
  _adicionarJuntaMecanica(grupoJunta, raio) {
    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(raio * 0.92, 14, 12),
      this.matMetal
    );
    grupoJunta.add(esfera);

    // Eixo transversal de titânio
    const eixo = new THREE.Mesh(
      new THREE.CylinderGeometry(raio * 0.36, raio * 0.36, raio * 2.28, 12),
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

    const positions = new Float32Array(this.maxPontosRastro * 3);
    const colors = new Float32Array(this.maxPontosRastro * 3);

    for (let i = 0; i < this.maxPontosRastro; i++) {
      const ratio = i / (this.maxPontosRastro - 1);
      // Gradiente ciano -> azul neon -> roxo suave na cauda
      colors[i * 3 + 0] = lerpVal(0.45, 0.0, ratio);
      colors[i * 3 + 1] = lerpVal(0.25, 1.0, ratio);
      colors[i * 3 + 2] = 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      linewidth: 2
    });

    this.linhaRastro = new THREE.Line(geo, mat);
    this.linhaRastro.frustumCulled = false;
    this.linhaRastro.visible = false;
    this.scene.add(this.linhaRastro);

    // Esfera luminosa no ponto focal do traçado
    const cursorGeo = new THREE.SphereGeometry(0.055, 12, 12);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: 0x00ffea,
      transparent: true,
      opacity: 0.9
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
    if (!this.linhaRastro || !this.rastroAtivo || !this.movimentoAtivo || !this.dedoRastro) {
      if (this.linhaRastro && this.linhaRastro.visible) this.limparRastro();
      return;
    }

    const objDedo = this.dedos[this.dedoRastro];
    if (!objDedo || !objDedo.ponta) return;

    this.grupo.updateMatrixWorld(true);
    objDedo.ponta.getWorldPosition(this._vecTemp);

    // Evita empilhar pontos idênticos
    const ultimo = this.pontosRastro[this.pontosRastro.length - 1];
    if (!ultimo || ultimo.distanceToSquared(this._vecTemp) > 0.00025) {
      this.pontosRastro.push(this._vecTemp.clone());
      if (this.pontosRastro.length > this.maxPontosRastro) {
        this.pontosRastro.shift();
      }
    }

    const n = this.pontosRastro.length;
    if (n < 2) return;

    const posAttr = this.linhaRastro.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const pt = this.pontosRastro[i];
      posAttr.setXYZ(i, pt.x, pt.y, pt.z);
    }
    posAttr.needsUpdate = true;
    this.linhaRastro.geometry.setDrawRange(0, n);
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
  // Executa cinemática amortecida das 15 juntas + trajetórias espaciais
  // ----------------------------------------------------------
  atualizar(delta) {
    this.tempoGlobal += delta;

    // Cascata mecânica realista: junta base (MCP) responde ligeiramente antes de PIP e DIP
    const lambdaBase = 10.5;
    const lambdaMid  = 9.0;
    const lambdaDist = 7.8;

    // Micro-oscilação orgânica de servo em standby
    const idleBreath = this.movimentoAtivo ? 0 : Math.sin(this.tempoGlobal * 1.9) * 0.012;

    for (const nome of Object.keys(this.dedos)) {
      const d = this.dedos[nome];

      d.atualX     = damp(d.atualX,     d.alvoX + idleBreath, lambdaBase, delta);
      d.atualMidX  = damp(d.atualMidX,  d.alvoMidX,           lambdaMid,  delta);
      d.atualDistX = damp(d.atualDistX, d.alvoDistX,          lambdaDist, delta);
      d.atualY     = damp(d.atualY,     d.alvoY,              lambdaBase, delta);
      d.atualZ     = damp(d.atualZ,     d.alvoZ,              lambdaBase, delta);

      if (d.base) {
        d.base.rotation.x = d.atualX;
        d.base.rotation.y = d.atualY;
        d.base.rotation.z = d.atualZ;
      }
      if (d.mid)  d.mid.rotation.x  = d.atualMidX;
      if (d.dist) d.dist.rotation.x = d.atualDistX;
    }

    // Interpola orientação base do pulso
    this.pulso.atualX = damp(this.pulso.atualX, this.pulso.alvoX, 8.5, delta);
    this.pulso.atualY = damp(this.pulso.atualY, this.pulso.alvoY, 8.5, delta);
    this.pulso.atualZ = damp(this.pulso.atualZ, this.pulso.alvoZ, 8.5, delta);

    // Calcula trajetórias espaciais 3D (Posição + Rotação dinâmica de pulso/dedos)
    let modRx = 0, modRy = 0, modRz = 0;
    let modPx = 0, modPy = 0, modPz = 0;

    if (this.movimentoAtivo) {
      this.tempoMovimento += delta;
      const t = this.tempoMovimento;

      switch (this.movimentoAtivo) {
        case 'tracar_j': {
          // Traçado espacial fiel da letra 'J' em Libras:
          // Fase 0..1 (Desce verticalmente) -> Fase 1..2 (Curva inferior em U para dentro/frente com giro de pulso) -> Fase 2..2.5 (Pausa no fim do J)
          const durCicloJ = 2.4;
          const faseJ = (t * 1.45) % durCicloJ;

          if (faseJ < 0.06) this.limparRastro();

          if (faseJ < 0.95) {
            // Haste vertical descendente
            const p = Easing.easeInOutCubic(faseJ / 0.95);
            modPx = 0.18;
            modPy = lerpVal(0.26, -0.18, p);
            modPz = lerpVal(0.0, 0.06, p);
            modRy = lerpVal(0.0, 0.12, p);
            modRz = lerpVal(0.0, 0.10, p);
          } else if (faseJ < 1.95) {
            // Gancho inferior semicircular + supinação de pulso
            const p = (faseJ - 0.95) / 1.0;
            const ang = p * Math.PI; // 0 a PI
            modPx = 0.02 + Math.cos(ang) * 0.16;
            modPy = -0.18 - Math.sin(ang) * 0.15;
            modPz = 0.06 + Math.sin(ang) * 0.14;
            modRy = 0.12 + Math.sin(ang * 0.85) * 0.42;
            modRz = 0.10 + Math.sin(ang) * 0.28;
            modRx = -Math.sin(ang) * 0.16;
          } else {
            // Breve sustentação final da letra J
            modPx = -0.14;
            modPy = -0.18;
            modPz = 0.06;
            modRy = 0.34;
            modRz = 0.12;
          }
          break;
        }

        case 'tracar_z': {
          // Traçado espacial fiel da letra 'Z' em 3 segmentos retilíneos + sustentação:
          // Seg 1 (0..0.8): Topo Esquerda -> Topo Direita
          // Seg 2 (0.8..1.7): Topo Direita -> Diagonal Base Esquerda
          // Seg 3 (1.7..2.5): Base Esquerda -> Base Direita
          // Pausa (2.5..3.0): Mantém no fim antes de reiniciar
          const durCicloZ = 3.0;
          const faseZ = (t * 1.55) % durCicloZ;

          if (faseZ < 0.06) this.limparRastro();

          if (faseZ < 0.80) {
            const p = Easing.easeInOutCubic(faseZ / 0.80);
            modPx = lerpVal(-0.30, 0.30, p);
            modPy = 0.24;
            modPz = 0.08;
            modRz = lerpVal(0.10, -0.10, p);
          } else if (faseZ < 1.70) {
            const p = Easing.easeInOutCubic((faseZ - 0.80) / 0.90);
            modPx = lerpVal(0.30, -0.30, p);
            modPy = lerpVal(0.24, -0.22, p);
            modPz = lerpVal(0.08, 0.14, Math.sin(p * Math.PI));
            modRz = lerpVal(-0.10, 0.12, p);
            modRx = lerpVal(0.0, 0.14, p);
          } else if (faseZ < 2.50) {
            const p = Easing.easeInOutCubic((faseZ - 1.70) / 0.80);
            modPx = lerpVal(-0.30, 0.30, p);
            modPy = -0.22;
            modPz = 0.08;
            modRz = lerpVal(0.12, -0.08, p);
            modRx = 0.14;
          } else {
            modPx = 0.30;
            modPy = -0.22;
            modPz = 0.08;
            modRz = -0.08;
            modRx = 0.14;
          }
          break;
        }

        case 'giro_pulso': {
          // Letra H: Giro de supinação/pronação no eixo Y + leve arco Z
          modRy = Math.sin(t * 5.2) * 0.44;
          modRz = Math.cos(t * 5.2) * 0.14;
          break;
        }

        case 'impulso_cima': {
          // Letra K: Impulso vertical com leve inclinação de pulso
          const pulsoK = Math.abs(Math.sin(t * 4.6));
          modPy = pulsoK * 0.22;
          modRx = -pulsoK * 0.15;
          break;
        }

        case 'puxar_x': {
          // Letra X: Gancho do indicador tracionando horizontalmente
          const puxada = Math.sin(t * 4.5);
          modPz = puxada * 0.18;
          modPx = -puxada * 0.10;
          if (this.dedos.indicador) {
            this.dedos.indicador.mid.rotation.x = this.dedos.indicador.atualMidX + Math.max(0, puxada) * 0.22;
          }
          break;
        }

        case 'agua_libras': {
          // Sinal oficial de ÁGUA: Mão em L com o indicador batendo duas vezes seguidas
          const cicloAgua = (t * 4.2) % (Math.PI * 2);
          const batidaDupla = cicloAgua < Math.PI * 1.35 ? Math.abs(Math.sin(cicloAgua * 2.0)) : 0;
          if (this.dedos.indicador && this.dedos.indicador.base) {
            this.dedos.indicador.base.rotation.x = this.dedos.indicador.atualX + batidaDupla * 0.58;
            this.dedos.indicador.mid.rotation.x  = this.dedos.indicador.atualMidX + batidaDupla * 0.25;
          }
          break;
        }

        case 'sim_aceno': {
          // Sinal de SIM: Punho em S flexionando o pulso afirmativamente
          modRx = Math.sin(t * 5.8) * 0.38;
          modPy = -Math.sin(t * 5.8) * 0.08;
          break;
        }

        case 'nao_abano': {
          // Sinal de NÃO: Indicador abanando lateralmente com o pulso
          modRz = Math.sin(t * 7.8) * 0.32;
          modPx = -Math.sin(t * 7.8) * 0.10;
          break;
        }

        case 'obrigado': {
          // Sinal de OBRIGADO: Mão parte da região frontal superior para frente
          const cicloOb = (t * 2.4) % (Math.PI * 2);
          const avanco = (1 - Math.cos(cicloOb)) * 0.5;
          modRx = avanco * 0.34;
          modPz = avanco * 0.26;
          modPy = 0.12 - avanco * 0.18;
          break;
        }

        case 'ajuda': {
          // Sinal de AJUDA (2 mãos): Elevação e avanço conjunto
          const avancoAj = (1 - Math.cos(t * 3.8)) * 0.5;
          modPz = avancoAj * 0.26;
          modPy = avancoAj * 0.16;
          break;
        }

        case 'comida_libras': {
          // Sinal de COMIDA: Dedos em pinça aproximando-se da boca repetidamente
          const toqueBoca = Math.sin(t * 5.6);
          modRx = toqueBoca * 0.24;
          modPy = toqueBoca * 0.14;
          modPz = -toqueBoca * 0.12;
          break;
        }

        case 'circular_peito': {
          // Sinal de POR FAVOR: Trajetória circular contínua no plano XY
          modPx = Math.cos(t * 4.2) * 0.20;
          modPy = Math.sin(t * 4.2) * 0.20;
          modRz = -Math.cos(t * 4.2) * 0.12;
          break;
        }

        case 'oscilar_pulso':
        case 'alerta_duplo':
        case 'perigo': {
          modRz = Math.sin(t * 7.2) * 0.26;
          modPy = Math.abs(Math.cos(t * 7.2)) * 0.08;
          break;
        }
      }
    } else {
      // Respiração mecânica sutil quando parado
      modPy = Math.sin(this.tempoGlobal * 1.6) * 0.025;
    }

    this.grupoPulso.rotation.set(
      this.pulso.atualX + modRx,
      this.pulso.atualY + modRy,
      this.pulso.atualZ + modRz
    );
    this.grupoPulso.position.set(modPx, modPy, modPz);

    // Atualiza trilha espacial 3D se houver movimento ativo
    this._atualizarRastro3D();
  }

  // ----------------------------------------------------------
  // posicaoNeutra()
  // ----------------------------------------------------------
  posicaoNeutra() {
    this.movimentoAtivo = null;
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
  // destruir() — Libera 100% dos recursos WebGL da mão e do rastro
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
    this.grupoPulso = null;
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

    // Estado de órbita esférica da câmera
    this.autoRotando = true;
    this.orbitaTheta = 0;
    this.orbitaPhi = 0.15;
    this.orbitaRaio = 5.25;
    this.arrastando = false;
    this.ultimoMouseX = 0;
    this.ultimoMouseY = 0;

    // Referências para cleanup
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

    // ── RENDERER WEBGL DE ALTA EFICIÊNCIA ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    this.renderer.domElement.style.cssText =
      'width:100%;height:100%;display:block;cursor:grab;touch-action:none;outline:none;';
    this.container.appendChild(this.renderer.domElement);

    // ── CENA & ATMOSFERA ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020a14, 0.045);

    // ── CÂMERA ──
    const w = this.container.clientWidth || 480;
    const h = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(39, w / h, 0.1, 80);
    this._atualizarPosicaoCamera();
    this._resize();

    // ── ILUMINAÇÃO DE ESTÚDIO BIOMÉDICO (4 PONTOS) ──
    const hemiLight = new THREE.HemisphereLight(0xbbe4ff, 0x081828, 0.88);
    this.scene.add(hemiLight);

    const luzPrincipal = new THREE.DirectionalLight(0xffffff, 1.85);
    luzPrincipal.position.set(3.2, 5.8, 4.6);
    luzPrincipal.castShadow = true;
    luzPrincipal.shadow.mapSize.set(1024, 1024);
    luzPrincipal.shadow.camera.near = 0.5;
    luzPrincipal.shadow.camera.far = 16;
    this.scene.add(luzPrincipal);

    const luzRimCiano = new THREE.PointLight(0x00e5ff, 1.65, 13);
    luzRimCiano.position.set(-3.8, 1.9, 2.4);
    this.scene.add(luzRimCiano);

    const luzRimVioleta = new THREE.PointLight(0xa855f7, 0.95, 13);
    luzRimVioleta.position.set(3.5, -0.6, -2.6);
    this.scene.add(luzRimVioleta);

    // ── PLATAFORMA HOLOGRÁFICA & PARTÍCULAS ──
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
    const planoSombra = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.ShadowMaterial({ opacity: 0.20 })
    );
    planoSombra.rotation.x = -Math.PI / 2;
    planoSombra.position.y = -1.36;
    planoSombra.receiveShadow = true;
    this.scene.add(planoSombra);

    // Anel externo fixo
    const anelExterno = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 0.96, 64),
      new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.30,
        side: THREE.DoubleSide
      })
    );
    anelExterno.rotation.x = -Math.PI / 2;
    anelExterno.position.y = -1.35;
    this.scene.add(anelExterno);

    // Anel interno técnico segmentado
    this.anelHoloInterno = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.65, 32, 1, 0, Math.PI * 1.65),
      new THREE.MeshBasicMaterial({
        color: 0x00ffea,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide
      })
    );
    this.anelHoloInterno.rotation.x = -Math.PI / 2;
    this.anelHoloInterno.position.y = -1.345;
    this.scene.add(this.anelHoloInterno);
  }

  _criarParticulas() {
    const count = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 9 - 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x00e5ff,
      size: 0.042,
      transparent: true,
      opacity: 0.38
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
      this.orbitaRaio = Math.max(3.1, Math.min(8.5, this.orbitaRaio + e.deltaY * 0.003));
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
    this.camera.position.y = 0.54 + r * Math.sin(phi);
    this.camera.position.z = r * Math.cos(th) * Math.cos(phi);
    this.camera.lookAt(0, 0.45, 0);
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
    this.orbitaPhi = 0.15;
    this.orbitaRaio = 5.25;

    if (this.camera) {
      smoothLerp(
        this.camera.position,
        {
          x: 0,
          y: 0.54 + 5.25 * Math.sin(0.15),
          z: 5.25 * Math.cos(0.15)
        },
        520,
        Easing.easeOutCubic,
        () => {
          if (this.camera) this.camera.lookAt(0, 0.45, 0);
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
