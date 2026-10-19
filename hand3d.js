// ============================================================
// hand3d.js — LibraTronic v3.2
// Mão robótica 3D articulada de alta precisão com Three.js
// Aparência: Prótese biônica branca técnica com núcleo LED neon
// Suporta:
//  - Cinemática independente das 3 falanges (MCP, PIP, DIP)
//  - Rotação anatômica do pulso + movimentos dinâmicos (J, Z, sinais)
//  - Controle interativo de órbita (mouse/touch drag + scroll zoom)
//  - Gerenciamento de memória WebGL sem vazamentos (dispose completo)
// ============================================================

// ============================================================
// UTILITÁRIO: smoothLerp (com cancelamento de animações concorrentes)
// ============================================================
var _lerpTimers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function smoothLerp(obj, targets, durationMs) {
  if (!obj) return;
  if (_lerpTimers && _lerpTimers.has(obj)) {
    cancelAnimationFrame(_lerpTimers.get(obj));
  }

  var start = {};
  var keys  = Object.keys(targets);
  keys.forEach(function(k) { start[k] = obj[k] || 0; });

  var t0  = performance.now();
  var dur = Math.max(durationMs || 400, 16);

  function tick(now) {
    var prog = Math.min((now - t0) / dur, 1);
    var ease = 1 - Math.pow(1 - prog, 3); // easeOutCubic
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      obj[k] = start[k] + (targets[k] - start[k]) * ease;
    }
    if (prog < 1) {
      var id = requestAnimationFrame(tick);
      if (_lerpTimers) _lerpTimers.set(obj, id);
    } else if (_lerpTimers) {
      _lerpTimers.delete(obj);
    }
  }

  var firstId = requestAnimationFrame(tick);
  if (_lerpTimers) _lerpTimers.set(obj, firstId);
}

// ============================================================
// CLASSE: MaoRobotica
// Constrói geometria 3D de uma mão biônica articulada.
// ============================================================
var MaoRobotica = (function() {

  function MaoRobotica(scene, posicaoX, espelhar) {
    this.scene    = scene;
    this.posicaoX = posicaoX || 0;
    this.espelhar = espelhar || false;

    // Grupo raiz (controla posição X da mão direita/esquerda e escala de espelhamento)
    this.grupo = new THREE.Group();

    // Grupo do pulso (controla orientação da mão e movimentos dinâmicos de sinais)
    this.grupoPulso = new THREE.Group();
    this.grupo.add(this.grupoPulso);

    // Dicionário dos dedos e estado do pulso
    this.dedos = {};
    this.pulso = {
      alvoX: 0, alvoY: 0, alvoZ: 0,
      atualX: 0, atualY: 0, atualZ: 0,
      offsetX: 0, offsetY: 0, offsetZ: 0
    };

    this.movimentoAtivo = null;
    this.tempoMovimento = 0;

    // ── MATERIAIS TÉCNICOS ──────────────────────────────────
    // Polímero branco cerâmico aeroespacial
    this.matBranco = new THREE.MeshStandardMaterial({
      color:     0xe4f0f8,
      roughness: 0.34,
      metalness: 0.14
    });

    // Titânio escuro anodizado (juntas, pistões, chassis interno)
    this.matMetal = new THREE.MeshStandardMaterial({
      color:     0x5b7c96,
      roughness: 0.28,
      metalness: 0.82
    });

    // Fibra técnica azul-escura (placas e cavidades)
    this.matDetalhe = new THREE.MeshStandardMaterial({
      color:     0x1e3448,
      roughness: 0.50,
      metalness: 0.40
    });

    // LED Neon Ciano (sensores táteis e anel energético)
    this.matNeon = new THREE.MeshStandardMaterial({
      color:             0x00e5ff,
      roughness:         0.15,
      metalness:         0.10,
      emissive:          new THREE.Color(0x00a8cc),
      emissiveIntensity: 0.85
    });
  }

  // ----------------------------------------------------------
  // criar()
  // Monta antebraço, pulso, palma anatômica e 5 dedos articulados
  // ----------------------------------------------------------
  MaoRobotica.prototype.criar = function() {
    this.grupo.position.set(this.posicaoX, -0.15, 0);
    if (this.espelhar) this.grupo.scale.x = -1;

    this._criarPulso();
    this._criarPalma();

    // 4 dedos principais: (nome, ox, oy, raio, [prox, med, dist], incZ)
    this._criarDedo('mindinho',  -0.54, 0.94, 0.088, [0.48, 0.33, 0.25],  0.09);
    this._criarDedo('anelar',    -0.19, 1.01, 0.098, [0.58, 0.39, 0.27],  0.03);
    this._criarDedo('medio',      0.17, 1.05, 0.106, [0.64, 0.42, 0.29],  0.00);
    this._criarDedo('indicador',  0.53, 0.99, 0.100, [0.57, 0.38, 0.27], -0.04);

    this._criarPolegar();

    this.scene.add(this.grupo);
  };

  // ----------------------------------------------------------
  // _criarPulso()
  // Base mecânica do pulso + antebraço com pistões e anel LED
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPulso = function() {
    // Junta esférica do pulso
    var esferaPulso = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 12),
      this.matMetal
    );
    esferaPulso.position.y = -0.06;
    this.grupoPulso.add(esferaPulso);

    // Colar superior chanfrado
    var colarSup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.39, 0.20, 16),
      this.matBranco
    );
    colarSup.position.y = -0.14;
    colarSup.castShadow = true;
    this.grupoPulso.add(colarSup);

    // Anel LED luminoso no pulso
    var anelLed = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.022, 10, 28),
      this.matNeon
    );
    anelLed.rotation.x = Math.PI / 2;
    anelLed.position.y = -0.24;
    this.grupoPulso.add(anelLed);

    // Corpo do antebraço superior
    var antebraco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.40, 0.48, 0.52, 16),
      this.matBranco
    );
    antebraco.position.y = -0.52;
    antebraco.castShadow = true;
    this.grupoPulso.add(antebraco);

    // 2 pistões hidráulicos laterais no pulso
    var posPistao = [-0.32, 0.32];
    for (var i = 0; i < posPistao.length; i++) {
      var pistao = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.56, 8),
        this.matMetal
      );
      pistao.position.set(posPistao[i], -0.32, 0.14);
      this.grupoPulso.add(pistao);
    }

    // Anel metálico da base
    var anelBase = new THREE.Mesh(
      new THREE.TorusGeometry(0.47, 0.035, 10, 24),
      this.matMetal
    );
    anelBase.rotation.x = Math.PI / 2;
    anelBase.position.y = -0.76;
    this.grupoPulso.add(anelBase);
  };

  // ----------------------------------------------------------
  // _criarPalma()
  // Palma anatômica com metacarpos, eminência tenar e núcleo neon
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPalma = function() {
    // Bloco central da palma
    var palmaCentral = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 0.86, 0.28),
      this.matBranco
    );
    palmaCentral.position.set(0, 0.44, 0);
    palmaCentral.castShadow    = true;
    palmaCentral.receiveShadow = true;
    this.grupoPulso.add(palmaCentral);

    // Bordas laterais arredondadas da palma para suavizar a silhueta
    var lateralEsq = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.13, 0.84, 12),
      this.matBranco
    );
    lateralEsq.position.set(-0.68, 0.44, 0);
    this.grupoPulso.add(lateralEsq);

    var lateralDir = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.84, 12),
      this.matBranco
    );
    lateralDir.position.set(0.68, 0.44, 0);
    this.grupoPulso.add(lateralDir);

    // Almofada tenar (músculo mecânico da base do polegar)
    var tenar = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 14, 12),
      this.matDetalhe
    );
    tenar.scale.set(1.1, 1.35, 0.72);
    tenar.position.set(0.50, 0.22, 0.10);
    this.grupoPulso.add(tenar);

    // Placa palmar interna amortecedora
    var placaPalmar = new THREE.Mesh(
      new THREE.BoxGeometry(1.14, 0.62, 0.05),
      this.matDetalhe
    );
    placaPalmar.position.set(0, 0.46, 0.14);
    this.grupoPulso.add(placaPalmar);

    // Placa dorsal com núcleo energético LED
    var placaDorsal = new THREE.Mesh(
      new THREE.BoxGeometry(1.10, 0.58, 0.05),
      this.matDetalhe
    );
    placaDorsal.position.set(0, 0.44, -0.14);
    this.grupoPulso.add(placaDorsal);

    // Anel energético biônico (palma e dorso)
    var nucleoGeo = new THREE.RingGeometry(0.11, 0.16, 20);
    var nucleoMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide
    });
    var nucleoFrente = new THREE.Mesh(nucleoGeo, nucleoMat);
    nucleoFrente.position.set(-0.04, 0.48, 0.172);
    this.grupoPulso.add(nucleoFrente);

    var nucleoDorso = new THREE.Mesh(nucleoGeo, nucleoMat);
    nucleoDorso.position.set(0, 0.44, -0.172);
    this.grupoPulso.add(nucleoDorso);

    // Knuckles (montantes das juntas metacarpofalangeanas)
    var posKnuckles = [-0.54, -0.19, 0.17, 0.53];
    for (var k = 0; k < posKnuckles.length; k++) {
      var knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(0.115, 12, 10),
        this.matMetal
      );
      knuckle.position.set(posKnuckles[k], 0.92, 0);
      this.grupoPulso.add(knuckle);
    }

    // Parafusos técnicos nos cantos
    var posPar = [[-0.50, 0.72], [-0.50, 0.18], [0.50, 0.72]];
    for (var j = 0; j < posPar.length; j++) {
      var paraf = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.06, 6),
        this.matMetal
      );
      paraf.rotation.x = Math.PI / 2;
      paraf.position.set(posPar[j][0], posPar[j][1], 0.155);
      this.grupoPulso.add(paraf);
    }
  };

  // ----------------------------------------------------------
  // _criarDedo(nome, ox, oy, raio, comps, incZ)
  // Cria um dedo com 3 falanges articuladas na direção palmar (+Z)
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarDedo = function(nome, ox, oy, raio, comps, incZ) {
    var grupoBase = new THREE.Group();
    grupoBase.position.set(ox, oy, 0);
    grupoBase.rotation.z = incZ || 0;

    // Falange proximal
    var fProx = this._segmento(raio, comps[0], false);
    grupoBase.add(fProx);

    // Junta PIP (proximal-média)
    var juntaMid = new THREE.Group();
    juntaMid.position.y = comps[0];
    this._addJunta(juntaMid, raio * 0.88);
    grupoBase.add(juntaMid);

    // Falange média
    var fMed = this._segmento(raio * 0.86, comps[1], false);
    juntaMid.add(fMed);

    // Junta DIP (média-distal)
    var juntaDist = new THREE.Group();
    juntaDist.position.y = comps[1];
    this._addJunta(juntaDist, raio * 0.76);
    juntaMid.add(juntaDist);

    // Falange distal com almofada tátil LED
    var fDist = this._segmento(raio * 0.74, comps[2], true);
    juntaDist.add(fDist);

    this.grupoPulso.add(grupoBase);

    this.dedos[nome] = {
      base:      grupoBase,
      mid:       juntaMid,
      dist:      juntaDist,
      defaultZ:  incZ || 0,
      alvoX:     0.05, alvoMidX: 0.05, alvoDistX: 0.04,
      alvoY:     0,    alvoZ:    incZ || 0,
      atualX:    0.05, atualMidX: 0.05, atualDistX: 0.04,
      atualY:    0,    atualZ:   incZ || 0
    };
  };

  // ----------------------------------------------------------
  // _criarPolegar()
  // Polegar com base opositora realista à frente da palma
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPolegar = function() {
    // Pivô CMC posicionado na lateral anterior da palma
    var grupoBase = new THREE.Group();
    grupoBase.position.set(0.72, 0.24, 0.12);
    grupoBase.rotation.set(0.10, 0.20, -1.05);

    this._addJunta(grupoBase, 0.125);

    var fProx = this._segmento(0.12, 0.44, false);
    grupoBase.add(fProx);

    var juntaIP = new THREE.Group();
    juntaIP.position.y = 0.44;
    this._addJunta(juntaIP, 0.105);
    grupoBase.add(juntaIP);

    var fDist = this._segmento(0.10, 0.36, true);
    juntaIP.add(fDist);

    this.grupoPulso.add(grupoBase);

    this.dedos['polegar'] = {
      base:      grupoBase,
      mid:       juntaIP,
      dist:      null,
      defaultZ:  -1.05,
      alvoX:     0.05, alvoMidX: 0.05, alvoDistX: 0,
      alvoY:     0.20, alvoZ:    -1.05,
      atualX:    0.05, atualMidX: 0.05, atualDistX: 0,
      atualY:    0.20, atualZ:   -1.05
    };
  };

  // ----------------------------------------------------------
  // _segmento(raio, altura, comPonta)
  // ----------------------------------------------------------
  MaoRobotica.prototype._segmento = function(raio, altura, comPonta) {
    var grupo = new THREE.Group();

    // Corpo cilíndrico chanfrado da falange
    var cilGeo = new THREE.CylinderGeometry(raio * 0.88, raio, altura, 14, 1);
    var cil    = new THREE.Mesh(cilGeo, this.matBranco);
    cil.position.y = altura / 2;
    cil.castShadow = true;
    cil.receiveShadow = true;
    grupo.add(cil);

    // Almofada palmar interna (frente do dedo +Z)
    var padGeo = new THREE.BoxGeometry(raio * 1.45, altura * 0.62, raio * 0.32);
    var pad    = new THREE.Mesh(padGeo, this.matDetalhe);
    pad.position.set(0, altura / 2, raio * 0.82);
    grupo.add(pad);

    // Anel metálico sutil de reforço
    var anelGeo = new THREE.CylinderGeometry(raio * 0.96, raio * 0.96, altura * 0.10, 12);
    var anel    = new THREE.Mesh(anelGeo, this.matMetal);
    anel.position.y = altura * 0.22;
    grupo.add(anel);

    if (comPonta) {
      // Cúpula arredondada na ponta do dedo
      var cupolaGeo = new THREE.SphereGeometry(
        raio * 0.88, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2
      );
      var cupola = new THREE.Mesh(cupolaGeo, this.matBranco);
      cupola.position.y = altura;
      grupo.add(cupola);

      // Sensor tátil LED neon na face palmar da ponta
      var sensorGeo = new THREE.SphereGeometry(raio * 0.45, 10, 8);
      var sensor    = new THREE.Mesh(sensorGeo, this.matNeon);
      sensor.scale.set(1.0, 1.2, 0.45);
      sensor.position.set(0, altura * 0.78, raio * 0.80);
      grupo.add(sensor);
    }

    return grupo;
  };

  // ----------------------------------------------------------
  // _addJunta(grupoJunta, raio)
  // ----------------------------------------------------------
  MaoRobotica.prototype._addJunta = function(grupoJunta, raio) {
    var esfera = new THREE.Mesh(
      new THREE.SphereGeometry(raio * 0.92, 12, 10),
      this.matMetal
    );
    grupoJunta.add(esfera);

    var eixoGeo = new THREE.CylinderGeometry(raio * 0.34, raio * 0.34, raio * 2.25, 10);
    var eixo    = new THREE.Mesh(eixoGeo, this.matMetal);
    eixo.rotation.z = Math.PI / 2;
    grupoJunta.add(eixo);
  };

  // ----------------------------------------------------------
  // setAlvo(nome, rx, ry, rz, midX, distX)
  // Define rotação alvo de um dedo com suporte a falanges independentes
  // ----------------------------------------------------------
  MaoRobotica.prototype.setAlvo = function(nome, rx, ry, rz, midX, distX) {
    var d = this.dedos[nome];
    if (!d) return;

    d.alvoX = rx || 0;
    d.alvoY = ry || 0;
    if (rz !== undefined) d.alvoZ = rz;

    if (nome === 'polegar') {
      d.alvoMidX = (midX !== undefined) ? midX : (d.alvoX * 0.85);
      d.alvoDistX = 0;
    } else {
      // Curvatura anatômica: se midX/distX não forem passados,
      // dobra proporcionalmente o suficiente para fechar o punho de verdade
      d.alvoMidX  = (midX  !== undefined) ? midX  : Math.min(d.alvoX * 1.05, 1.70);
      d.alvoDistX = (distX !== undefined) ? distX : Math.min(d.alvoX * 0.78, 1.35);
    }
  };

  // ----------------------------------------------------------
  // setPulsoAlvo(rx, ry, rz)
  // ----------------------------------------------------------
  MaoRobotica.prototype.setPulsoAlvo = function(rx, ry, rz) {
    this.pulso.alvoX = rx || 0;
    this.pulso.alvoY = ry || 0;
    this.pulso.alvoZ = rz || 0;
  };

  // ----------------------------------------------------------
  // aplicarPose(rotacoes3d, movimento)
  // ----------------------------------------------------------
  MaoRobotica.prototype.aplicarPose = function(rotacoes3d, movimento) {
    if (!rotacoes3d) return;

    var p = rotacoes3d.pulso || { x: 0, y: 0, z: 0 };
    this.setPulsoAlvo(p.x, p.y, p.z);

    var DEDOS = ['polegar', 'indicador', 'medio', 'anelar', 'mindinho'];
    for (var i = 0; i < DEDOS.length; i++) {
      var nome = DEDOS[i];
      var r    = rotacoes3d[nome];
      if (r) {
        this.setAlvo(nome, r.x, r.y, r.z, r.midX, r.distX);
      }
    }

    this.movimentoAtivo = movimento || null;
    this.tempoMovimento = 0;
  };

  // ----------------------------------------------------------
  // atualizar(delta)
  // Interpola dedos, pulso e executa movimentos dinâmicos de Libras
  // ----------------------------------------------------------
  MaoRobotica.prototype.atualizar = function(delta) {
    var spd = 7.5;
    var fac = Math.min(spd * delta, 1);

    // 1. Interpola os 5 dedos
    var nomes = Object.keys(this.dedos);
    for (var i = 0; i < nomes.length; i++) {
      var d = this.dedos[nomes[i]];

      d.atualX     += (d.alvoX     - d.atualX)     * fac;
      d.atualMidX  += (d.alvoMidX  - d.atualMidX)  * fac;
      d.atualDistX += (d.alvoDistX - d.atualDistX) * fac;
      d.atualY     += (d.alvoY     - d.atualY)     * fac;
      d.atualZ     += (d.alvoZ     - d.atualZ)     * fac;

      if (d.base) {
        d.base.rotation.x = d.atualX;
        d.base.rotation.y = d.atualY;
        d.base.rotation.z = d.atualZ;
      }
      if (d.mid)  d.mid.rotation.x  = d.atualMidX;
      if (d.dist) d.dist.rotation.x = d.atualDistX;
    }

    // 2. Interpola orientação base do pulso
    this.pulso.atualX += (this.pulso.alvoX - this.pulso.atualX) * fac;
    this.pulso.atualY += (this.pulso.alvoY - this.pulso.atualY) * fac;
    this.pulso.atualZ += (this.pulso.alvoZ - this.pulso.atualZ) * fac;

    // 3. Movimentos dinâmicos de sinais e letras (J, Z, H, K, X, ÁGUA, SIM, NÃO, etc.)
    var modRx = 0, modRy = 0, modRz = 0;
    var modPx = 0, modPy = 0, modPz = 0;

    if (this.movimentoAtivo) {
      this.tempoMovimento += delta;
      var t = this.tempoMovimento;

      switch (this.movimentoAtivo) {
        case 'tracar_j':
          // Desenha a curva do J com o mindinho (desce e curva para dentro/cima)
          var cicloJ = (t * 2.2) % (Math.PI * 2);
          modPy = -Math.sin(cicloJ) * 0.22;
          modPx = -Math.cos(cicloJ) * 0.16;
          modRz = Math.sin(cicloJ) * 0.35;
          break;

        case 'tracar_z':
          // Traça as 3 retas da letra Z no espaço
          var faseZ = (t * 1.8) % 3.0;
          if (faseZ < 1.0) {
            modPx = -0.25 + faseZ * 0.50;
            modPy = 0.20;
          } else if (faseZ < 2.0) {
            var p2 = faseZ - 1.0;
            modPx = 0.25 - p2 * 0.50;
            modPy = 0.20 - p2 * 0.40;
          } else {
            var p3 = faseZ - 2.0;
            modPx = -0.25 + p3 * 0.50;
            modPy = -0.20;
          }
          break;

        case 'giro_pulso':
          // Letra H: pequeno giro rotacional no eixo Y do pulso
          modRy = Math.sin(t * 5.0) * 0.38;
          break;

        case 'impulso_cima':
          // Letra K: pequeno movimento vertical para cima
          modPy = Math.abs(Math.sin(t * 4.5)) * 0.18;
          break;

        case 'puxar_x':
          // Letra X: puxa levemente o gancho na direção do corpo
          modPz = Math.sin(t * 4.5) * 0.16;
          break;

        case 'agua_libras':
          // Sinal oficial de ÁGUA em Libras: mão em L com indicador batendo duas vezes
          var batida = Math.abs(Math.sin(t * 6.5));
          if (this.dedos.indicador && this.dedos.indicador.base) {
            this.dedos.indicador.base.rotation.x = this.dedos.indicador.atualX + batida * 0.52;
          }
          break;

        case 'sim_aceno':
          // Sinal de SIM: punho em S acenando verticalmente
          modRx = Math.sin(t * 6.0) * 0.35;
          break;

        case 'nao_abano':
          // Sinal de NÃO: indicador abanando lateralmente
          modRz = Math.sin(t * 7.5) * 0.28;
          break;

        case 'obrigado':
          // Mão em B partindo da cabeça/queixo para frente
          modRx = Math.sin(t * 3.8) * 0.25;
          modPz = Math.sin(t * 3.8) * 0.20;
          break;

        case 'ajuda':
          // Impulso conjunto para frente
          modPz = Math.sin(t * 4.0) * 0.22;
          modPy = Math.abs(Math.sin(t * 4.0)) * 0.10;
          break;

        case 'comida_libras':
          // Movimento levando os dedos unidos em direção à boca
          modRx = Math.sin(t * 5.5) * 0.22;
          modPy = Math.sin(t * 5.5) * 0.12;
          break;

        case 'circular_peito':
          // Movimento circular de POR FAVOR
          modPx = Math.cos(t * 4.5) * 0.16;
          modPy = Math.sin(t * 4.5) * 0.16;
          break;

        case 'oscilar_pulso':
        case 'alerta_duplo':
        case 'perigo':
          modRz = Math.sin(t * 7.0) * 0.24;
          break;
      }
    }

    this.grupoPulso.rotation.set(
      this.pulso.atualX + modRx,
      this.pulso.atualY + modRy,
      this.pulso.atualZ + modRz
    );
    this.grupoPulso.position.set(modPx, modPy, modPz);
  };

  // ----------------------------------------------------------
  // posicaoNeutra()
  // Retorna todos os dedos e pulso à pose aberta e relaxada
  // ----------------------------------------------------------
  MaoRobotica.prototype.posicaoNeutra = function() {
    this.movimentoAtivo = null;
    this.tempoMovimento = 0;
    this.setPulsoAlvo(0, 0, 0);
    this.setAlvo('polegar',   0.05, 0.20, -1.05, 0.05, 0);
    this.setAlvo('indicador', 0.06, 0.0,  -0.04, 0.06, 0.04);
    this.setAlvo('medio',     0.06, 0.0,   0.00, 0.06, 0.04);
    this.setAlvo('anelar',    0.06, 0.0,   0.03, 0.06, 0.04);
    this.setAlvo('mindinho',  0.06, 0.0,   0.09, 0.06, 0.04);
  };

  // ----------------------------------------------------------
  // destruir()
  // Libera todas as Geometries e Materials da GPU (zero memory leak)
  // ----------------------------------------------------------
  MaoRobotica.prototype.destruir = function() {
    if (!this.grupo) return;
    if (this.scene) this.scene.remove(this.grupo);

    this.grupo.traverse(function(obj) {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(function(m) { if (m && m.dispose) m.dispose(); });
        } else if (obj.material.dispose) {
          obj.material.dispose();
        }
      }
    });

    this.grupo = null;
    this.grupoPulso = null;
    this.dedos = {};
  };

  return MaoRobotica;
})();


// ============================================================
// CLASSE: LibraHand3D
// Gerencia cena Three.js completa: câmera, luzes, controles e mãos
// ============================================================
var LibraHand3D = (function() {

  function LibraHand3D(containerId) {
    this.containerId  = containerId;
    this.container    = null;
    this.renderer     = null;
    this.scene        = null;
    this.camera       = null;
    this.clock        = null;
    this.rafId        = null;
    this.maoDir       = null;
    this.maoEsq       = null;
    this.particulas   = null;
    this.modoDuasMaos = false;
    this.pronto       = false;

    // Estado de órbita da câmera (suporta auto-rotação + drag manual + zoom)
    this.autoRotando  = true;
    this.orbitaTheta  = 0;       // ângulo horizontal (rad)
    this.orbitaPhi    = 0.16;    // ângulo vertical (rad)
    this.orbitaRaio   = 5.3;     // distância da câmera
    this.arrastando   = false;
    this.ultimoMouseX = 0;
    this.ultimoMouseY = 0;

    // Referências de listeners para remoção limpa no destruir()
    this._onResize           = null;
    this._onVisibilityChange = null;
    this._onPointerDown      = null;
    this._onPointerMove      = null;
    this._onPointerUp        = null;
    this._onWheel            = null;
  }

  // ----------------------------------------------------------
  // setUp()
  // ----------------------------------------------------------
  LibraHand3D.prototype.setUp = function() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn('[LibraHand3D] Container não encontrado:', this.containerId);
      return;
    }

    this.clock = new THREE.Clock();

    // ── RENDERER ──
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Compatibilidade Three.js r128 (sRGBEncoding) e r152+ (SRGBColorSpace)
    if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab;touch-action:none;';
    this.container.appendChild(this.renderer.domElement);

    // ── CENA ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020a14, 0.048);

    // ── CÂMERA ──
    var w = this.container.clientWidth  || 480;
    var h = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 80);
    this._atualizarPosicaoCamera();
    this._resize();

    // ── ILUMINAÇÃO TÉCNICA DE ESTÚDIO ──
    this.scene.add(new THREE.AmbientLight(0x9cc4dc, 0.85));

    var luzMain = new THREE.DirectionalLight(0xffffff, 1.85);
    luzMain.position.set(3.0, 5.5, 4.5);
    luzMain.castShadow = true;
    luzMain.shadow.mapSize.set(1024, 1024);
    luzMain.shadow.camera.near = 0.5;
    luzMain.shadow.camera.far  = 16;
    this.scene.add(luzMain);

    var luzRimEsq = new THREE.PointLight(0x00d4ff, 1.6, 12);
    luzRimEsq.position.set(-3.8, 1.8, 2.2);
    this.scene.add(luzRimEsq);

    var luzRimDir = new THREE.PointLight(0xa855f7, 0.9, 12);
    luzRimDir.position.set(3.5, -0.5, -2.5);
    this.scene.add(luzRimDir);

    // ── BASE HOLOGRÁFICA E PLANO DE SOMBRA ──
    this._criarBaseHolografica();

    // ── PARTÍCULAS DE FUNDO ──
    this._criarParticulas();

    // ── MÃO DIREITA (Principal) ──
    this.maoDir = new MaoRobotica(this.scene, 0, false);
    this.maoDir.criar();
    this.maoDir.posicaoNeutra();

    // ── MÃO ESQUERDA (Pré-alocada e oculta para evitar recriação/leaks) ──
    this.maoEsq = new MaoRobotica(this.scene, -1.35, true);
    this.maoEsq.criar();
    this.maoEsq.posicaoNeutra();
    this.maoEsq.grupo.visible = false;

    // ── EVENT LISTENERS (Com referências salvas para cleanup) ──
    this._registrarEventos();

    this.pronto = true;
    this._loop();
  };

  // ----------------------------------------------------------
  // _criarBaseHolografica()
  // ----------------------------------------------------------
  LibraHand3D.prototype._criarBaseHolografica = function() {
    var planoSombra = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    planoSombra.rotation.x    = -Math.PI / 2;
    planoSombra.position.y    = -1.35;
    planoSombra.receiveShadow = true;
    this.scene.add(planoSombra);

    // Anel holográfico sob o pulso
    var anelBase = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.90, 48),
      new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide
      })
    );
    anelBase.rotation.x = -Math.PI / 2;
    anelBase.position.y = -1.34;
    this.scene.add(anelBase);
  };

  // ----------------------------------------------------------
  // _registrarEventos()
  // Registra resize, visibilitychange e controles de órbita
  // ----------------------------------------------------------
  LibraHand3D.prototype._registrarEventos = function() {
    var self = this;
    var dom  = this.renderer.domElement;

    this._onResize = function() { self._resize(); };
    window.addEventListener('resize', this._onResize);

    this._onVisibilityChange = function() {
      if (!self.pronto) return;
      if (document.hidden) {
        if (self.rafId) {
          cancelAnimationFrame(self.rafId);
          self.rafId = null;
        }
      } else {
        if (self.clock) self.clock.getDelta();
        if (!self.rafId) self._loop();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Controles de arrastar (Mouse / Touch via Pointer Events)
    this._onPointerDown = function(e) {
      self.arrastando   = true;
      self.ultimoMouseX = e.clientX;
      self.ultimoMouseY = e.clientY;
      dom.style.cursor  = 'grabbing';
    };

    this._onPointerMove = function(e) {
      if (!self.arrastando) return;
      var dx = e.clientX - self.ultimoMouseX;
      var dy = e.clientY - self.ultimoMouseY;
      self.ultimoMouseX = e.clientX;
      self.ultimoMouseY = e.clientY;

      self.orbitaTheta -= dx * 0.008;
      self.orbitaPhi    = Math.max(-0.45, Math.min(0.85, self.orbitaPhi + dy * 0.006));
      self._atualizarPosicaoCamera();
    };

    this._onPointerUp = function() {
      if (!self.arrastando) return;
      self.arrastando  = false;
      if (dom) dom.style.cursor = 'grab';
    };

    this._onWheel = function(e) {
      e.preventDefault();
      self.orbitaRaio = Math.max(3.2, Math.min(8.5, self.orbitaRaio + e.deltaY * 0.003));
      self._atualizarPosicaoCamera();
    };

    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
  };

  // ----------------------------------------------------------
  // _atualizarPosicaoCamera()
  // ----------------------------------------------------------
  LibraHand3D.prototype._atualizarPosicaoCamera = function() {
    if (!this.camera) return;
    var r   = this.orbitaRaio;
    var phi = this.orbitaPhi;
    var th  = this.orbitaTheta;

    this.camera.position.x = r * Math.sin(th) * Math.cos(phi);
    this.camera.position.y = 0.55 + r * Math.sin(phi);
    this.camera.position.z = r * Math.cos(th) * Math.cos(phi);
    this.camera.lookAt(0, 0.45, 0);
  };

  // ----------------------------------------------------------
  // _loop()
  // ----------------------------------------------------------
  LibraHand3D.prototype._loop = function() {
    if (!this.pronto) return;

    var self = this;
    this.rafId = requestAnimationFrame(function() { self._loop(); });

    var delta = Math.min(this.clock.getDelta(), 0.1);

    if (this.maoDir) this.maoDir.atualizar(delta);
    if (this.maoEsq && this.maoEsq.grupo && this.maoEsq.grupo.visible) {
      this.maoEsq.atualizar(delta);
    }

    if (this.particulas) {
      this.particulas.rotation.y += delta * 0.03;
    }

    if (this.autoRotando && !this.arrastando) {
      this.orbitaTheta += delta * 0.26;
      this._atualizarPosicaoCamera();
    }

    this.renderer.render(this.scene, this.camera);
  };

  // ----------------------------------------------------------
  // _resize()
  // ----------------------------------------------------------
  LibraHand3D.prototype._resize = function() {
    if (!this.container || !this.renderer || !this.camera) return;
    var w = this.container.clientWidth  || 480;
    var h = this.container.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // ----------------------------------------------------------
  // _criarParticulas()
  // ----------------------------------------------------------
  LibraHand3D.prototype._criarParticulas = function() {
    var count = 140;
    var geo   = new THREE.BufferGeometry();
    var pos   = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x00d4ff,
      size: 0.045,
      transparent: true,
      opacity: 0.42
    });
    this.particulas = new THREE.Points(geo, mat);
    this.scene.add(this.particulas);
  };

  // ----------------------------------------------------------
  // animarLetra(rotacoes3d, movimento)
  // ----------------------------------------------------------
  LibraHand3D.prototype.animarLetra = function(rotacoes3d, movimento) {
    this._ativarUmaMao();
    if (!rotacoes3d || !this.maoDir) return;
    this.maoDir.aplicarPose(rotacoes3d, movimento || null);
  };

  // ----------------------------------------------------------
  // animarPalavra(dadosPalavra)
  // ----------------------------------------------------------
  LibraHand3D.prototype.animarPalavra = function(dadosPalavra) {
    if (!dadosPalavra) return;

    if (dadosPalavra.duas_maos) {
      this._ativarDuasMaos();
    } else {
      this._ativarUmaMao();
    }

    var mov = dadosPalavra.movimento || null;

    if (this.maoDir && dadosPalavra.mao_direita && dadosPalavra.mao_direita.rotacoes3d) {
      this.maoDir.aplicarPose(dadosPalavra.mao_direita.rotacoes3d, mov);
    }

    if (this.maoEsq && dadosPalavra.duas_maos && dadosPalavra.mao_esquerda && dadosPalavra.mao_esquerda.rotacoes3d) {
      this.maoEsq.aplicarPose(dadosPalavra.mao_esquerda.rotacoes3d, mov);
    }
  };

  // ----------------------------------------------------------
  // posicaoNeutra()
  // ----------------------------------------------------------
  LibraHand3D.prototype.posicaoNeutra = function() {
    if (this.maoDir) this.maoDir.posicaoNeutra();
    if (this.maoEsq) this.maoEsq.posicaoNeutra();
  };

  // ----------------------------------------------------------
  // _ativarUmaMao()
  // ----------------------------------------------------------
  LibraHand3D.prototype._ativarUmaMao = function() {
    if (!this.modoDuasMaos) return;
    this.modoDuasMaos = false;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 0 }, 480);
    }
    if (this.maoEsq && this.maoEsq.grupo) {
      this.maoEsq.posicaoNeutra();
      this.maoEsq.grupo.visible = false;
    }
  };

  // ----------------------------------------------------------
  // _ativarDuasMaos()
  // ----------------------------------------------------------
  LibraHand3D.prototype._ativarDuasMaos = function() {
    this.modoDuasMaos = true;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 1.25 }, 480);
    }
    if (this.maoEsq && this.maoEsq.grupo) {
      this.maoEsq.grupo.visible = true;
      smoothLerp(this.maoEsq.grupo.position, { x: -1.25 }, 480);
    }
  };

  // ----------------------------------------------------------
  // toggleRotacao()
  // ----------------------------------------------------------
  LibraHand3D.prototype.toggleRotacao = function() {
    this.autoRotando = !this.autoRotando;
    return this.autoRotando;
  };

  // ----------------------------------------------------------
  // resetarCamera()
  // ----------------------------------------------------------
  LibraHand3D.prototype.resetarCamera = function() {
    var self = this;
    this.autoRotando = false;
    this.orbitaTheta = 0;
    this.orbitaPhi   = 0.16;
    this.orbitaRaio  = 5.3;
    smoothLerp(this.camera.position, {
      x: 0,
      y: 0.55 + 5.3 * Math.sin(0.16),
      z: 5.3 * Math.cos(0.16)
    }, 550);
    setTimeout(function() {
      if (self.camera) self.camera.lookAt(0, 0.45, 0);
    }, 560);
  };

  // ----------------------------------------------------------
  // destruir()
  // Limpeza completa de eventos DOM, loops RAF e memória WebGL
  // ----------------------------------------------------------
  LibraHand3D.prototype.destruir = function() {
    this.pronto = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Remove todos os listeners globais e do canvas
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._onPointerMove) window.removeEventListener('pointermove', this._onPointerMove);
    if (this._onPointerUp) window.removeEventListener('pointerup', this._onPointerUp);

    if (this.renderer && this.renderer.domElement) {
      var dom = this.renderer.domElement;
      if (this._onPointerDown) dom.removeEventListener('pointerdown', this._onPointerDown);
      if (this._onWheel) dom.removeEventListener('wheel', this._onWheel);
    }

    // Libera geometrias e materiais das mãos
    if (this.maoDir) { this.maoDir.destruir(); this.maoDir = null; }
    if (this.maoEsq) { this.maoEsq.destruir(); this.maoEsq = null; }

    // Libera o restante da cena (partículas, planos, anéis)
    if (this.scene) {
      this.scene.traverse(function(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(function(m) { if (m && m.dispose) m.dispose(); });
          } else if (obj.material.dispose) {
            obj.material.dispose();
          }
        }
      });
      this.scene = null;
    }

    // Libera contexto WebGL e remove canvas do DOM
    if (this.renderer) {
      this.renderer.dispose();
      var el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      this.renderer = null;
    }

    this.camera    = null;
    this.container = null;
  };

  return LibraHand3D;
})();

var libraHand3D = null;
