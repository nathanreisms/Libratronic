// ============================================================
// hand3d.js — LibraTronic v3
// Mão robótica 3D articulada com Three.js
// Aparência: prótese branca técnica impressa em 3D
// Suporta: uma mão (soletração) + duas mãos (gestos)
// ============================================================

// ============================================================
// UTILITÁRIO: smoothLerp
// Anima propriedades numéricas de um objeto ao longo do tempo
// sem depender de biblioteca externa (GSAP, Tween.js etc.)
// @param obj       — objeto cujas propriedades serão animadas
// @param targets   — {chave: valorAlvo} a atingir
// @param durationMs — duração total da animação em ms
// ============================================================
function smoothLerp(obj, targets, durationMs) {
  var start = {};
  var keys  = Object.keys(targets);
  // Salva valores iniciais de cada propriedade
  keys.forEach(function(k) { start[k] = obj[k]; });

  var t0 = performance.now();

  function tick(now) {
    var prog = Math.min((now - t0) / durationMs, 1); // 0 → 1
    var ease = 1 - Math.pow(1 - prog, 3);            // easeOutCubic
    keys.forEach(function(k) {
      obj[k] = start[k] + (targets[k] - start[k]) * ease;
    });
    if (prog < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
// CLASSE: MaoRobotica
// Constrói geometria 3D de uma mão mecânica articulada.
// Cada dedo tem 3 falanges com juntas visíveis.
// Aparência: prótese branca semi-fosca com detalhes metálicos.
// ============================================================
var MaoRobotica = (function() {

  // ----------------------------------------------------------
  // constructor
  // @param scene    — THREE.Scene de destino
  // @param posicaoX — offset horizontal na cena
  // @param espelhar — true = mão esquerda (scale.x = -1)
  // ----------------------------------------------------------
  function MaoRobotica(scene, posicaoX, espelhar) {
    this.scene    = scene;
    this.posicaoX = posicaoX || 0;
    this.espelhar = espelhar || false;

    // Grupo raiz — toda a mão fica dentro
    this.grupo = new THREE.Group();

    // Dicionário dos dedos
    // cada entrada: { base, mid, dist, alvoX, alvoY, alvoZ, atualX, atualY, atualZ }
    this.dedos = {};

    // ── MATERIAIS ──────────────────────────────────────────

    // Plástico branco técnico (corpo das falanges e palma)
    this.matBranco = new THREE.MeshStandardMaterial({
      color:     0xd8e8f0,   // branco levemente azulado
      roughness: 0.50,
      metalness: 0.10,
    });

    // Metal cinza-azul (juntas, eixos, anéis do pulso)
    this.matMetal = new THREE.MeshStandardMaterial({
      color:     0x7090a8,
      roughness: 0.25,
      metalness: 0.75,
    });

    // Neon ciano (sensores nas pontas dos dedos)
    this.matNeon = new THREE.MeshStandardMaterial({
      color:             0x00c4ef,
      roughness:         0.20,
      metalness:         0.10,
      emissive:          new THREE.Color(0x002233),
      emissiveIntensity: 0.65,
    });

    // Detalhe escuro (ranhuras, placas internas)
    this.matDetalhe = new THREE.MeshStandardMaterial({
      color:     0x4a6880,
      roughness: 0.60,
      metalness: 0.30,
    });
  }

  // ----------------------------------------------------------
  // criar()
  // Monta toda a geometria e adiciona o grupo à cena.
  // ----------------------------------------------------------
  MaoRobotica.prototype.criar = function() {
    this.grupo.position.x = this.posicaoX;
    // Mão esquerda: espelha no eixo X
    if (this.espelhar) this.grupo.scale.x = -1;

    this._criarPulso();
    this._criarPalma();

    // Cria os 4 dedos principais (offsets na palma, raios, comprimentos, inclinação)
    this._criarDedo('mindinho',  -0.56, 0.95, 0.09, [0.52, 0.36, 0.26], -0.15);
    this._criarDedo('anelar',    -0.19, 1.00, 0.10, [0.60, 0.40, 0.28], -0.07);
    this._criarDedo('medio',      0.18, 1.04, 0.11, [0.66, 0.42, 0.30],  0.00);
    this._criarDedo('indicador',  0.55, 0.98, 0.10, [0.58, 0.38, 0.28],  0.07);

    this._criarPolegar();

    this.scene.add(this.grupo);
  };

  // ----------------------------------------------------------
  // _criarPulso()
  // Cilindro mecânico abaixo da palma com anéis decorativos
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPulso = function() {
    // Cilindro principal
    var geo  = new THREE.CylinderGeometry(0.42, 0.50, 0.55, 10, 1);
    var mesh = new THREE.Mesh(geo, this.matBranco);
    mesh.position.y = -0.28;
    mesh.castShadow = true;
    this.grupo.add(mesh);

    // Anéis decorativos (topo e base do pulso)
    var anelGeo = new THREE.TorusGeometry(0.44, 0.035, 8, 20);
    var anel1   = new THREE.Mesh(anelGeo, this.matMetal);
    anel1.rotation.x = Math.PI / 2;
    anel1.position.y = 0.00;
    this.grupo.add(anel1);

    var anel2 = new THREE.Mesh(anelGeo, this.matMetal);
    anel2.rotation.x = Math.PI / 2;
    anel2.position.y = -0.52;
    this.grupo.add(anel2);

    // Eixo conector abaixo do pulso
    var eixoGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.35, 8);
    var eixo    = new THREE.Mesh(eixoGeo, this.matMetal);
    eixo.position.y = -0.72;
    this.grupo.add(eixo);
  };

  // ----------------------------------------------------------
  // _criarPalma()
  // Corpo principal da palma com placa frontal e detalhes
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPalma = function() {
    // Corpo da palma
    var geo  = new THREE.BoxGeometry(1.45, 0.80, 0.30, 2, 2, 1);
    var mesh = new THREE.Mesh(geo, this.matBranco);
    mesh.position.y    = 0.40;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    this.grupo.add(mesh);

    // Placa frontal decorativa
    var placaGeo = new THREE.BoxGeometry(1.18, 0.60, 0.04);
    var placa    = new THREE.Mesh(placaGeo, this.matDetalhe);
    placa.position.set(0, 0.40, 0.17);
    this.grupo.add(placa);

    // Ranhuras verticais (linhas técnicas)
    for (var i = -2; i <= 2; i++) {
      var r = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.55, 0.045),
        this.matMetal
      );
      r.position.set(i * 0.27, 0.40, 0.19);
      this.grupo.add(r);
    }

    // 4 parafusos nos cantos
    var posPar = [[-0.50, 0.72], [-0.50, 0.10], [0.50, 0.72], [0.50, 0.10]];
    for (var j = 0; j < posPar.length; j++) {
      var paraf = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.06, 6),
        this.matMetal
      );
      paraf.rotation.x = Math.PI / 2;
      paraf.position.set(posPar[j][0], posPar[j][1], 0.20);
      this.grupo.add(paraf);
    }
  };

  // ----------------------------------------------------------
  // _criarDedo(nome, ox, oy, raio, comps, incZ)
  // Cria um dedo com 3 falanges e 2 juntas articuladas.
  // @param nome  — chave no dicionário this.dedos
  // @param ox,oy — offset X,Y da base na palma
  // @param raio  — espessura do dedo
  // @param comps — [comprimento proximal, médio, distal]
  // @param incZ  — inclinação lateral natural do dedo (rad)
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarDedo = function(nome, ox, oy, raio, comps, incZ) {
    var self = this;

    // Grupo raiz do dedo (toda a cadeia cinemática)
    var grupoBase = new THREE.Group();
    grupoBase.position.set(ox, oy, 0);
    grupoBase.rotation.z = incZ || 0;

    // Falange proximal
    var fProx = self._segmento(raio, comps[0], false);
    grupoBase.add(fProx);

    // Junta proximal-média
    var juntaMid = new THREE.Group();
    juntaMid.position.y = comps[0];
    self._addJunta(juntaMid, raio * 0.85);
    grupoBase.add(juntaMid);

    // Falange média
    var fMed = self._segmento(raio * 0.86, comps[1], false);
    juntaMid.add(fMed);

    // Junta média-distal
    var juntaDist = new THREE.Group();
    juntaDist.position.y = comps[1];
    self._addJunta(juntaDist, raio * 0.74);
    juntaMid.add(juntaDist);

    // Falange distal com sensor
    var fDist = self._segmento(raio * 0.73, comps[2], true);
    juntaDist.add(fDist);

    this.grupo.add(grupoBase);

    // Registra no dicionário para animação
    this.dedos[nome] = {
      base:    grupoBase,
      mid:     juntaMid,
      dist:    juntaDist,
      alvoX:   0,        alvoY: 0, alvoZ: incZ || 0,
      atualX:  0,        atualY: 0, atualZ: incZ || 0,
    };
  };

  // ----------------------------------------------------------
  // _criarPolegar()
  // Polegar com posição e ângulo laterais específicos
  // ----------------------------------------------------------
  MaoRobotica.prototype._criarPolegar = function() {
    var self = this;

    var grupoBase = new THREE.Group();
    grupoBase.position.set(0.82, 0.05, 0.06);
    grupoBase.rotation.z = -1.10;
    grupoBase.rotation.y =  0.25;

    var fProx = self._segmento(0.13, 0.42, false);
    grupoBase.add(fProx);

    var junta = new THREE.Group();
    junta.position.y = 0.42;
    self._addJunta(junta, 0.11);
    grupoBase.add(junta);

    var fDist = self._segmento(0.10, 0.34, true);
    junta.add(fDist);

    this.grupo.add(grupoBase);

    this.dedos['polegar'] = {
      base:    grupoBase,
      mid:     junta,
      dist:    null,
      alvoX:   0, alvoY: 0, alvoZ: -1.10,
      atualX:  0, atualY: 0, atualZ: -1.10,
    };
  };

  // ----------------------------------------------------------
  // _segmento(raio, altura, comPonta)
  // Cria cilindro de falange com detalhe mecânico e sensor opcional
  // ----------------------------------------------------------
  MaoRobotica.prototype._segmento = function(raio, altura, comPonta) {
    var grupo = new THREE.Group();

    // Cilindro principal da falange
    var cilGeo = new THREE.CylinderGeometry(raio * 0.88, raio, altura, 9, 1);
    var cil    = new THREE.Mesh(cilGeo, this.matBranco);
    cil.position.y = altura / 2;
    cil.castShadow = true;
    grupo.add(cil);

    // Ranhura frontal decorativa
    var rGeo = new THREE.BoxGeometry(raio * 1.75, altura * 0.18, raio * 0.30);
    var r    = new THREE.Mesh(rGeo, this.matDetalhe);
    r.position.set(0, altura / 2, raio * 0.86);
    grupo.add(r);

    if (comPonta) {
      // Cúpula arredondada da ponta
      var cupolaGeo = new THREE.SphereGeometry(
        raio * 0.88, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2
      );
      var cupola = new THREE.Mesh(cupolaGeo, this.matBranco);
      cupola.rotation.x = Math.PI;
      cupola.position.y = altura;
      grupo.add(cupola);

      // Sensor LED neon na ponta
      var sGeo = new THREE.CylinderGeometry(raio * 0.38, raio * 0.38, 0.022, 9);
      var s    = new THREE.Mesh(sGeo, this.matNeon);
      s.position.y = altura + 0.005;
      grupo.add(s);
    }

    return grupo;
  };

  // ----------------------------------------------------------
  // _addJunta(grupoJunta, raio)
  // Insere pino + colares (articulação visível entre falanges)
  // ----------------------------------------------------------
  MaoRobotica.prototype._addJunta = function(grupoJunta, raio) {
    // Eixo horizontal (pino da articulação)
    var eixoGeo = new THREE.CylinderGeometry(raio * 0.32, raio * 0.32, raio * 2.4, 8);
    var eixo    = new THREE.Mesh(eixoGeo, this.matMetal);
    eixo.rotation.z = Math.PI / 2;
    grupoJunta.add(eixo);

    // Colares laterais do pino
    var posX = [-raio * 1.05, raio * 1.05];
    for (var i = 0; i < posX.length; i++) {
      var cGeo = new THREE.CylinderGeometry(raio * 0.48, raio * 0.48, 0.035, 8);
      var c    = new THREE.Mesh(cGeo, this.matBranco);
      c.rotation.z = Math.PI / 2;
      c.position.x = posX[i];
      grupoJunta.add(c);
    }
  };

  // ----------------------------------------------------------
  // setAlvo(nome, rx, ry, rz)
  // Define rotação alvo de um dedo. A animação lerp atingirá
  // esse valor ao longo de vários frames.
  // ----------------------------------------------------------
  MaoRobotica.prototype.setAlvo = function(nome, rx, ry, rz) {
    var d = this.dedos[nome];
    if (!d) return;
    d.alvoX = rx;
    d.alvoY = ry;
    if (rz !== undefined) d.alvoZ = rz;
  };

  // ----------------------------------------------------------
  // atualizar(delta)
  // Interpola rotações atuais → alvos a cada frame.
  // @param delta — segundos desde o frame anterior
  // ----------------------------------------------------------
  MaoRobotica.prototype.atualizar = function(delta) {
    var spd   = 5.0; // velocidade de interpolação
    var nomes = Object.keys(this.dedos);

    for (var i = 0; i < nomes.length; i++) {
      var d   = this.dedos[nomes[i]];
      var fac = Math.min(spd * delta, 1);

      // Lerp em X, Y, Z
      d.atualX += (d.alvoX - d.atualX) * fac;
      d.atualY += (d.alvoY - d.atualY) * fac;
      d.atualZ += (d.alvoZ - d.atualZ) * fac;

      // Aplica ao grupo base (falange proximal + cadeia)
      if (d.base) {
        d.base.rotation.x = d.atualX;
        d.base.rotation.y = d.atualY;
        d.base.rotation.z = d.atualZ;
      }
      // Falange média: 55% da curvatura do base
      if (d.mid)  d.mid.rotation.x  = d.atualX * 0.55;
      // Falange distal: 30%
      if (d.dist) d.dist.rotation.x = d.atualX * 0.30;
    }
  };

  // ----------------------------------------------------------
  // posicaoNeutra()
  // Retorna todos os dedos à pose aberta/relaxada inicial
  // ----------------------------------------------------------
  MaoRobotica.prototype.posicaoNeutra = function() {
    this.setAlvo('polegar',   0.00,  0.0, -1.10);
    this.setAlvo('indicador', 0.05,  0.0,  0.07);
    this.setAlvo('medio',     0.05,  0.0,  0.00);
    this.setAlvo('anelar',    0.05,  0.0, -0.07);
    this.setAlvo('mindinho',  0.05,  0.0, -0.15);
  };

  return MaoRobotica;
})();


// ============================================================
// CLASSE: LibraHand3D
// Gerencia cena Three.js completa: câmera, luzes, mãos.
// Interface pública usada pelo script.js.
// ============================================================
var LibraHand3D = (function() {

  // ----------------------------------------------------------
  // constructor
  // @param containerId — id do elemento HTML container
  // ----------------------------------------------------------
  function LibraHand3D(containerId) {
    this.containerId  = containerId;
    this.container    = null;
    this.renderer     = null;
    this.scene        = null;
    this.camera       = null;
    this.clock        = null;
    this.rafId        = null;
    this.maoDir       = null;   // mão direita (sempre presente)
    this.maoEsq       = null;   // mão esquerda (modo duas mãos)
    this.modoDuasMaos = false;
    this.pronto       = false;
    this.autoRotY     = 0;
    this.autoRotando  = true;   // rotação automática da câmera
  }

  // ----------------------------------------------------------
  // setUp()
  // Cria renderer, cena, câmera, luzes, mão direita e inicia loop.
  // ----------------------------------------------------------
  LibraHand3D.prototype.setUp = function() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn('[LibraHand3D] Container não encontrado:', this.containerId);
      return;
    }

    // ── CLOCK ──
    this.clock = new THREE.Clock();

    // ── RENDERER ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace  = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
    this.container.appendChild(this.renderer.domElement);
    this._resize();

    // ── CENA ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x020a14, 0.055); // neblina futurista

    // ── CÂMERA ──
    var w = this.container.clientWidth;
    var h = this.container.clientHeight || 400;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 80);
    this.camera.position.set(0, 1.2, 5.5);
    this.camera.lookAt(0, 0.6, 0);

    // ── LUZES ──
    // Ambiente: ilumina tudo uniformemente
    this.scene.add(new THREE.AmbientLight(0x90b8cc, 0.80));

    // Direcional principal (spot técnico)
    var luzMain = new THREE.DirectionalLight(0xffffff, 2.0);
    luzMain.position.set(2.5, 5, 4);
    luzMain.castShadow = true;
    luzMain.shadow.mapSize.set(1024, 1024);
    luzMain.shadow.camera.near = 0.1;
    luzMain.shadow.camera.far  = 18;
    this.scene.add(luzMain);

    // Neon lateral esquerdo (rim light azul)
    var luzNeon = new THREE.PointLight(0x00d4ff, 1.4, 10);
    luzNeon.position.set(-3.5, 1.5, 2);
    this.scene.add(luzNeon);

    // Traseira suave (contorno)
    var luzBack = new THREE.DirectionalLight(0x002244, 0.55);
    luzBack.position.set(0, -1, -4);
    this.scene.add(luzBack);

    // ── PLANO DE SOMBRA ──
    var plano = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.ShadowMaterial({ opacity: 0.12 })
    );
    plano.rotation.x  = -Math.PI / 2;
    plano.position.y  = -1.8;
    plano.receiveShadow = true;
    this.scene.add(plano);

    // ── PARTÍCULAS DE FUNDO ──
    this._criarParticulas();

    // ── MÃO DIREITA ──
    this.maoDir = new MaoRobotica(this.scene, 0, false);
    this.maoDir.criar();
    this.maoDir.posicaoNeutra();

    // ── RESIZE LISTENER ──
    var self = this;
    window.addEventListener('resize', function() { self._resize(); });

    // ── INICIA LOOP ──
    this.pronto = true;
    this._loop();
  };

  // ----------------------------------------------------------
  // _loop()
  // Loop de renderização chamado pelo requestAnimationFrame
  // ----------------------------------------------------------
  LibraHand3D.prototype._loop = function() {
    var self = this;
    this.rafId = requestAnimationFrame(function() { self._loop(); });

    var delta = this.clock.getDelta();

    // Atualiza interpolação de dedos
    if (this.maoDir) this.maoDir.atualizar(delta);
    if (this.maoEsq) this.maoEsq.atualizar(delta);

    // Rotação suave da câmera ao redor da mão
    if (this.autoRotando) {
      this.autoRotY += 0.004;
      this.camera.position.x = Math.sin(this.autoRotY) * 5.5;
      this.camera.position.z = Math.cos(this.autoRotY) * 5.5;
      this.camera.lookAt(0, 0.6, 0);
    }

    this.renderer.render(this.scene, this.camera);
  };

  // ----------------------------------------------------------
  // _resize()
  // Atualiza renderer e câmera ao redimensionar a janela
  // ----------------------------------------------------------
  LibraHand3D.prototype._resize = function() {
    if (!this.container || !this.renderer || !this.camera) return;
    var w = this.container.clientWidth;
    var h = this.container.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // ----------------------------------------------------------
  // _criarParticulas()
  // Pontos flutuantes no fundo — efeito futurista neon
  // ----------------------------------------------------------
  LibraHand3D.prototype._criarParticulas = function() {
    var count = 180;
    var geo   = new THREE.BufferGeometry();
    var pos   = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x00d4ff, size: 0.045, transparent: true, opacity: 0.45
    });
    this.scene.add(new THREE.Points(geo, mat));
  };

  // ----------------------------------------------------------
  // animarLetra(rotacoes3d)
  // Anima UMA mão para a configuração de uma letra Libras.
  // @param rotacoes3d — objeto {polegar, indicador, ...} do banco
  // ----------------------------------------------------------
  LibraHand3D.prototype.animarLetra = function(rotacoes3d) {
    this._ativarUmaMao();
    if (!rotacoes3d) return;
    var DEDOS = ['polegar', 'indicador', 'medio', 'anelar', 'mindinho'];
    for (var i = 0; i < DEDOS.length; i++) {
      var r = rotacoes3d[DEDOS[i]];
      if (r) this.maoDir.setAlvo(DEDOS[i], r.x, r.y, r.z);
    }
  };

  // ----------------------------------------------------------
  // animarPalavra(dadosPalavra)
  // Anima as mãos para um gesto completo de palavra-chave.
  // @param dadosPalavra — entrada do banco "palavras"
  // ----------------------------------------------------------
  LibraHand3D.prototype.animarPalavra = function(dadosPalavra) {
    if (!dadosPalavra) return;

    // Decide modo: uma ou duas mãos
    if (dadosPalavra.duas_maos) {
      this._ativarDuasMaos();
    } else {
      this._ativarUmaMao();
    }

    var DEDOS = ['polegar', 'indicador', 'medio', 'anelar', 'mindinho'];

    // Mão direita
    if (dadosPalavra.mao_direita && dadosPalavra.mao_direita.rotacoes3d) {
      var rd = dadosPalavra.mao_direita.rotacoes3d;
      for (var i = 0; i < DEDOS.length; i++) {
        var r = rd[DEDOS[i]];
        if (r) this.maoDir.setAlvo(DEDOS[i], r.x, r.y, r.z);
      }
    }

    // Mão esquerda (se modo duas mãos)
    if (this.maoEsq && dadosPalavra.mao_esquerda && dadosPalavra.mao_esquerda.rotacoes3d) {
      var re = dadosPalavra.mao_esquerda.rotacoes3d;
      for (var j = 0; j < DEDOS.length; j++) {
        var r2 = re[DEDOS[j]];
        if (r2) this.maoEsq.setAlvo(DEDOS[j], r2.x, r2.y, r2.z);
      }
    }
  };

  // ----------------------------------------------------------
  // posicaoNeutra()
  // Retorna todas as mãos à pose aberta inicial
  // ----------------------------------------------------------
  LibraHand3D.prototype.posicaoNeutra = function() {
    if (this.maoDir) this.maoDir.posicaoNeutra();
    if (this.maoEsq) this.maoEsq.posicaoNeutra();
  };

  // ----------------------------------------------------------
  // _ativarUmaMao()
  // Centraliza mão direita, remove mão esquerda da cena
  // ----------------------------------------------------------
  LibraHand3D.prototype._ativarUmaMao = function() {
    if (!this.modoDuasMaos) return;
    this.modoDuasMaos = false;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 0 }, 600);
    }
    if (this.maoEsq && this.maoEsq.grupo) {
      this.scene.remove(this.maoEsq.grupo);
      this.maoEsq = null;
    }
  };

  // ----------------------------------------------------------
  // _ativarDuasMaos()
  // Afasta mão direita, cria/posiciona mão esquerda
  // ----------------------------------------------------------
  LibraHand3D.prototype._ativarDuasMaos = function() {
    this.modoDuasMaos = true;

    if (this.maoDir && this.maoDir.grupo) {
      smoothLerp(this.maoDir.grupo.position, { x: 1.5 }, 600);
    }

    if (!this.maoEsq) {
      this.maoEsq = new MaoRobotica(this.scene, -1.5, true); // espelhada
      this.maoEsq.criar();
      this.maoEsq.posicaoNeutra();
    } else {
      smoothLerp(this.maoEsq.grupo.position, { x: -1.5 }, 600);
    }
  };

  // ----------------------------------------------------------
  // toggleRotacao()
  // Liga/desliga rotação automática da câmera
  // ----------------------------------------------------------
  LibraHand3D.prototype.toggleRotacao = function() {
    this.autoRotando = !this.autoRotando;
    return this.autoRotando;
  };

  // ----------------------------------------------------------
  // resetarCamera()
  // Volta a câmera à posição inicial
  // ----------------------------------------------------------
  LibraHand3D.prototype.resetarCamera = function() {
    this.autoRotY    = 0;
    this.autoRotando = false;
    smoothLerp(this.camera.position, { x: 0, y: 1.2, z: 5.5 }, 700);
  };

  // ----------------------------------------------------------
  // destruir()
  // Para o loop e libera todos os recursos WebGL
  // ----------------------------------------------------------
  LibraHand3D.prototype.destruir = function() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.renderer) {
      this.renderer.dispose();
      var el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    this.pronto = false;
  };

  return LibraHand3D;
})();

// Instância global — inicializada pelo script.js quando a tela de texto abre
var libraHand3D = null;