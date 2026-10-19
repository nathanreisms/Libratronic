// ============================================================
// script.js — LibraTronic v3.2
// Tradução Libras oficial · Câmera MediaPipe · Web Speech API
// Reconhecimento geométrico corrigido · Controle de memória
// ============================================================

// ============================================================
// SEÇÃO 1 — ESTADO GLOBAL
// ============================================================

// Palavras-chave que ativam gesto completo em Libras (ordenadas da maior para menor p/ match de frases)
var PALAVRAS_CHAVE = [
  'POR FAVOR', 'OBRIGADO', 'BANHEIRO', 'SOCORRO',
  'COMIDA', 'PERIGO', 'AJUDA', 'AGUA', 'SIM', 'NAO'
];

var bancoDados = null;

// ── PREFERÊNCIAS DE TRADUÇÃO E ÁUDIO ───────────────────────
var vozAtiva           = true;
var velocidadeTraducao = 1.0; // 0.7 (Lento), 1.0 (Normal), 1.5 (Rápido)

// Mapa fonético para pronúncia natural em Português (Web Speech API)
var MAPA_FONETICO = {
  'A': 'á', 'B': 'bê', 'C': 'cê', 'D': 'dê', 'E': 'ê', 'F': 'éfe',
  'G': 'gê', 'H': 'agá', 'I': 'i', 'J': 'jóta', 'K': 'cá', 'L': 'éle',
  'M': 'ême', 'N': 'êne', 'O': 'ô', 'P': 'pê', 'Q': 'quê', 'R': 'érre',
  'S': 'ésse', 'T': 'tê', 'U': 'u', 'V': 'vê', 'W': 'dáblio', 'X': 'xis',
  'Y': 'ípsilon', 'Z': 'zê',
  'AGUA': 'água',
  'NAO': 'não',
  'SIM': 'sim',
  'AJUDA': 'ajuda',
  'SOCORRO': 'socorro',
  'OBRIGADO': 'obrigado',
  'COMIDA': 'comida',
  'BANHEIRO': 'banheiro',
  'PERIGO': 'perigo',
  'POR FAVOR': 'por favor'
};

// ── BLUETOOTH ──────────────────────────────────────────────
var btDevice     = null;
var btCarac      = null;
var btConectado  = false;
var btConectando = false;
var BT_UUID_SERVICO = '0000ffe0-0000-1000-8000-00805f9b34fb';
var BT_UUID_CARAC   = '0000ffe1-0000-1000-8000-00805f9b34fb';

// ── TRADUÇÃO E TIMERS (Prevenção de vazamento/race conditions) ──
var traduzindo      = false;
var abortarTraducao = false;
var timersTraducao  = [];
var telaAtual       = 'home';

function registrarTimeout(fn, ms) {
  var id = setTimeout(function() {
    var idx = timersTraducao.indexOf(id);
    if (idx >= 0) timersTraducao.splice(idx, 1);
    fn();
  }, ms);
  timersTraducao.push(id);
  return id;
}

function limparTimeoutsTraducao() {
  for (var i = 0; i < timersTraducao.length; i++) {
    clearTimeout(timersTraducao[i]);
  }
  timersTraducao = [];
}

// ── CÂMERA E BUFFER DE ESTABILIDADE ────────────────────────
var cameraStream     = null;
var cameraAtiva      = false;
var cameraEspelhada  = true;
var camRafId         = null;
var mpHands          = null;
var mpCamera         = null;
var processandoFrame = false;

var frameBufferLetra    = '';
var frameBufferContador = 0;
var FRAMES_NECESSARIOS  = 12;

// ── DEBOUNCE DE RECONHECIMENTO ─────────────────────────────
var ultimaLetra   = '';
var tsUltimaLetra = 0;
var DEBOUNCE_MS   = 1800;

// ============================================================
// SEÇÃO 2 — INICIALIZAÇÃO DO DOM
// ============================================================

document.addEventListener('DOMContentLoaded', function() {

  carregarBanco();
  popularTecladoAZ();
  mostrarTela('home');

  // ── HOME ──
  document.getElementById('btn-ir-texto')
    .addEventListener('click', function() { mostrarTela('text'); });
  document.getElementById('btn-ir-camera')
    .addEventListener('click', function() { mostrarTela('camera'); });
  document.getElementById('btn-ir-bluetooth')
    .addEventListener('click', function() { mostrarTela('bluetooth'); });

  // ── VOLTAR (todas as telas) ──
  document.querySelectorAll('.btn-back').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pararTraducaoAtiva();
      pararCamera();
      if (libraHand3D) {
        libraHand3D.destruir();
        libraHand3D = null;
      }
      mostrarTela('home');
    });
  });

  // ── TELA TEXTO ──
  document.getElementById('btn-traduzir').addEventListener('click', iniciarTraducao);
  document.getElementById('btn-limpar').addEventListener('click', limparCampo);

  // Controles de Voz e Velocidade
  var btnVoz = document.getElementById('btn-toggle-voz');
  if (btnVoz) {
    btnVoz.addEventListener('click', function() {
      vozAtiva = !vozAtiva;
      btnVoz.textContent = vozAtiva ? '🔊 Voz: ON' : '🔇 Voz: OFF';
      btnVoz.classList.toggle('muted', !vozAtiva);
      if (!vozAtiva && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    });
  }

  var selVel = document.getElementById('select-velocidade');
  if (selVel) {
    selVel.addEventListener('change', function() {
      velocidadeTraducao = parseFloat(this.value) || 1.0;
      log('⏱ Velocidade ajustada para ' + velocidadeTraducao + 'x', 'info');
    });
  }

  // Enter no textarea = traduzir
  document.getElementById('input-texto').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      iniciarTraducao();
    }
  });

  // Normaliza acentos (ex: ÁGUA -> AGUA, NÃO -> NAO) preservando posição do cursor
  document.getElementById('input-texto').addEventListener('input', function() {
    var pos = this.selectionStart;
    var limpo = this.value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z \n]/g, '');
    if (this.value !== limpo) {
      this.value = limpo;
      try { this.setSelectionRange(pos, pos); } catch (e) {}
    }
  });

  // ── CONTROLES 3D ──
  document.getElementById('btn-3d-rotacionar').addEventListener('click', toggle3DRotacao);
  document.getElementById('btn-3d-resetar').addEventListener('click', resetar3DCamera);
  var btnNeutra = document.getElementById('btn-3d-neutra');
  if (btnNeutra) {
    btnNeutra.addEventListener('click', function() {
      if (libraHand3D && libraHand3D.pronto) {
        libraHand3D._ativarUmaMao();
        libraHand3D.posicaoNeutra();
        setLetraAtual('');
        setFeedbackModo('Posição neutra / repouso');
      }
    });
  }

  // ── GESTOS RÁPIDOS ──
  document.querySelectorAll('.btn-palavra').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var palavra = btn.getAttribute('data-p');
      document.getElementById('input-texto').value = palavra;
      if (traduzindo) pararTraducaoAtiva();
      iniciarTraducao();
    });
  });

  // ── CÂMERA ──
  document.getElementById('btn-toggle-camera').addEventListener('click', toggleCamera);

  var btnEspelhar = document.getElementById('btn-espelhar-camera');
  if (btnEspelhar) {
    btnEspelhar.addEventListener('click', function() {
      cameraEspelhada = !cameraEspelhada;
      var wrap = document.getElementById('camera-wrap');
      if (wrap) wrap.classList.toggle('mirrored', cameraEspelhada);
      btnEspelhar.textContent = cameraEspelhada ? '🪞 Espelhar: ON' : '🪞 Espelhar: OFF';
    });
  }

  var btnCamEspaco = document.getElementById('btn-cam-espaco');
  if (btnCamEspaco) {
    btnCamEspaco.addEventListener('click', function() {
      var el = document.getElementById('texto-detectado');
      if (el && el.textContent && !el.textContent.endsWith(' ')) {
        el.textContent += ' ';
        ultimaLetra = '';
      }
    });
  }

  var btnCamApagar = document.getElementById('btn-cam-apagar');
  if (btnCamApagar) {
    btnCamApagar.addEventListener('click', function() {
      var el = document.getElementById('texto-detectado');
      if (el && el.textContent.length > 0) {
        el.textContent = el.textContent.slice(0, -1);
        ultimaLetra = '';
      }
    });
  }

  var btnCamFalar = document.getElementById('btn-cam-falar');
  if (btnCamFalar) {
    btnCamFalar.addEventListener('click', function() {
      var el = document.getElementById('texto-detectado');
      if (el && el.textContent.trim()) {
        falarTextoLivre(el.textContent.trim());
      }
    });
  }

  document.getElementById('btn-limpar-cam').addEventListener('click', function() {
    document.getElementById('texto-detectado').textContent = '';
    document.getElementById('conf-fill').style.width = '0%';
    var stab = document.getElementById('stab-fill');
    if (stab) stab.style.width = '0%';
    var elConf = document.getElementById('lbl-confianca');
    if (elConf) elConf.textContent = '';
    var elLetra = document.getElementById('letra-camera-detectada');
    if (elLetra) elLetra.textContent = '—';
    ultimaLetra = '';
  });

  // ── BLUETOOTH E REFERÊNCIA ALFABETO ──
  document.getElementById('btn-bt-conectar').addEventListener('click', conectarBluetooth);
  document.getElementById('btn-bt-desconectar').addEventListener('click', desconectarBluetooth);

  // Torna os chips de referência na tela Bluetooth clicáveis para ir direto ver em 3D
  document.querySelectorAll('#ref-alfabeto-bt .chip').forEach(function(chip) {
    chip.classList.add('clickable');
    chip.addEventListener('click', function() {
      var letra = chip.textContent.trim();
      mostrarTela('text');
      registrarTimeout(function() {
        visualizarLetraUnica3D(letra);
      }, 420);
    });
  });
});

// ============================================================
// SEÇÃO 3 — TECLADO RÁPIDO A–Z E NAVEGAÇÃO
// ============================================================

function popularTecladoAZ() {
  var container = document.getElementById('alfabeto-rapido');
  if (!container) return;
  container.innerHTML = '';

  var alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  alfabeto.forEach(function(letra) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-letra-az';
    btn.textContent = letra;
    btn.title = 'Visualizar letra ' + letra + ' na mão 3D';
    btn.setAttribute('aria-label', 'Letra ' + letra);
    btn.addEventListener('click', function() {
      if (traduzindo) pararTraducaoAtiva();
      visualizarLetraUnica3D(letra);
    });
    container.appendChild(btn);
  });
}

function visualizarLetraUnica3D(letra) {
  var dados = buscarLetra(letra);
  if (!dados) return;

  document.querySelectorAll('.btn-letra-az').forEach(function(b) {
    b.classList.toggle('active', b.textContent === letra);
  });

  setLetraAtual(letra);
  setFeedbackModo(dados.descricao || ('Letra ' + letra + ' em Libras'));

  if (libraHand3D && libraHand3D.pronto && dados.rotacoes3d) {
    libraHand3D.animarLetra(dados.rotacoes3d, dados.movimento);
  }

  falar(letra);

  if (btConectado && btCarac && dados.comando) {
    enviarBT(dados.comando);
    log('↗ ' + letra + ' → ' + dados.comando, 'success');
  } else {
    log('👁 Visualizando letra ' + letra + (dados.descricao ? ' (' + dados.descricao + ')' : ''), 'info');
  }
}

function mostrarTela(id) {
  pararTraducaoAtiva();
  telaAtual = id;

  document.querySelectorAll('.screen').forEach(function(t) {
    t.classList.remove('active');
  });

  var tela = document.getElementById('screen-' + id);
  if (tela) tela.classList.add('active');

  if (id === 'text') {
    registrarTimeout(inicializar3D, 120);
  }
}

// ============================================================
// SEÇÃO 4 — BANCO DE DADOS
// ============================================================

function carregarBanco() {
  fetch('./database.json')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(d) {
      bancoDados = d;
      if (d.configuracoes && d.configuracoes.debounceCamera) {
        DEBOUNCE_MS = d.configuracoes.debounceCamera;
      }
      log('✓ Banco Libras carregado — 26 letras + ' +
          Object.keys(d.palavras || {}).length + ' sinais oficiais', 'success');
    })
    .catch(function() {
      bancoDados = getBancoFallback();
      log('ℹ Banco Libras interno carregado (26 letras + 10 sinais)', 'info');
    });
}

function buscarLetra(l) {
  if (!bancoDados || !bancoDados.letras) return null;
  return bancoDados.letras[l] || null;
}

function buscarPalavra(p) {
  if (!bancoDados || !bancoDados.palavras) return null;
  return bancoDados.palavras[p] || null;
}

function detectarPalavraChaveExata(texto) {
  var t = texto.trim().toUpperCase();
  for (var i = 0; i < PALAVRAS_CHAVE.length; i++) {
    if (t === PALAVRAS_CHAVE[i]) return PALAVRAS_CHAVE[i];
  }
  return null;
}

// Tokeniza um texto misto em itens: { tipo: 'palavra' | 'letra' | 'espaco', valor: string }
function tokenizarTextoLibras(texto) {
  var limpo = texto.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!limpo) return [];

  // Substitui "POR FAVOR" temporariamente por um token único se presente na frase
  var marcadorPF = '__POR_FAVOR__';
  var processado = limpo.replace(/\bPOR FAVOR\b/g, marcadorPF);
  var partes = processado.split(' ');
  var tokens = [];

  for (var i = 0; i < partes.length; i++) {
    var p = partes[i] === marcadorPF ? 'POR FAVOR' : partes[i];
    if (!p) continue;

    if (i > 0) {
      tokens.push({ tipo: 'espaco', valor: '⎵' });
    }

    if (PALAVRAS_CHAVE.indexOf(p) >= 0 && buscarPalavra(p)) {
      tokens.push({ tipo: 'palavra', valor: p });
    } else {
      for (var c = 0; c < p.length; c++) {
        var ch = p[c];
        if (/[A-Z]/.test(ch)) {
          tokens.push({ tipo: 'letra', valor: ch });
        }
      }
    }
  }
  return tokens;
}

// ============================================================
// SEÇÃO 5 — MOTOR 3D
// ============================================================

function inicializar3D() {
  if (telaAtual !== 'text') return;
  if (typeof THREE === 'undefined') {
    log('⚠ Three.js não carregado — verifique sua conexão', 'error');
    return;
  }

  // Se já estiver pronto e ativo no mesmo container, apenas redimensiona
  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D._resize();
    return;
  }

  if (libraHand3D) {
    libraHand3D.destruir();
    libraHand3D = null;
  }

  libraHand3D = new LibraHand3D('hand3d-container');
  libraHand3D.setUp();

  if (window.removerLoading3D) window.removerLoading3D();
  log('✓ Mão biônica 3D inicializada', 'success');
}

function toggle3DRotacao() {
  if (!libraHand3D) return;
  var ativo = libraHand3D.toggleRotacao();
  var btn   = document.getElementById('btn-3d-rotacionar');
  if (btn) {
    btn.textContent = ativo ? '⏸ Rotação' : '▶ Rotação';
    btn.classList.toggle('ativo', ativo);
  }
}

function resetar3DCamera() {
  if (!libraHand3D) return;
  libraHand3D.resetarCamera();
  var btn = document.getElementById('btn-3d-rotacionar');
  if (btn) {
    btn.textContent = '▶ Rotação';
    btn.classList.remove('ativo');
  }
}

// ============================================================
// SEÇÃO 6 — TRADUÇÃO POR TEXTO E FRASES MISTAS
// ============================================================

function atualizarBotaoTraduzir(emAndamento) {
  var b = document.getElementById('btn-traduzir');
  if (!b) return;
  if (emAndamento) {
    b.innerHTML = '&#9209;&nbsp; Parar';
    b.classList.add('stop-mode');
  } else {
    b.innerHTML = '&#9654;&nbsp; Traduzir';
    b.classList.remove('stop-mode');
  }
}

function pararTraducaoAtiva() {
  abortarTraducao = true;
  traduzindo      = false;
  limparTimeoutsTraducao();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  atualizarBotaoTraduzir(false);
}

function iniciarTraducao() {
  if (traduzindo) {
    pararTraducaoAtiva();
    if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
    setFeedbackModo('Tradução interrompida pelo usuário');
    log('⏹ Tradução interrompida', 'info');
    return;
  }

  limparTimeoutsTraducao();

  var inputEl = document.getElementById('input-texto');
  var texto   = inputEl ? inputEl.value.trim().toUpperCase() : '';
  if (!texto) {
    log('⚠ Digite uma palavra ou frase para traduzir!', 'error');
    return;
  }

  var pkExata = detectarPalavraChaveExata(texto);
  if (pkExata) {
    traduzirGestoCompleto(pkExata);
  } else {
    traduzirSequenciaTokens(texto);
  }
}

async function traduzirSequenciaTokens(texto) {
  var tokens = tokenizarTextoLibras(texto);
  var tokensVisiveis = tokens.filter(function(t) { return t.tipo !== 'espaco'; });

  if (tokensVisiveis.length === 0) {
    log('⚠ Nenhuma letra válida encontrada!', 'error');
    return;
  }

  renderizarChips(tokensVisiveis);

  traduzindo      = true;
  abortarTraducao = false;
  atualizarBotaoTraduzir(true);

  log('▶ Traduzindo: "' + texto + '"', 'info');

  var chipIdx = 0;
  var fatorVel = 1 / (velocidadeTraducao || 1.0);

  for (var t = 0; t < tokens.length; t++) {
    if (abortarTraducao) break;

    var item = tokens[t];

    if (item.tipo === 'espaco') {
      await tratarEspaco(fatorVel);
      continue;
    }

    marcarChip(chipIdx, 'active');

    if (item.tipo === 'palavra') {
      var dadosP = buscarPalavra(item.valor);
      if (dadosP) {
        var modo = dadosP.duas_maos ? 'Sinal com duas mãos' : 'Sinal com uma mão';
        setFeedbackModo(modo + ' — ' + (dadosP.descricao || item.valor));
        setLetraAtualGrande(item.valor);
        if (libraHand3D && libraHand3D.pronto) {
          libraHand3D.animarPalavra(dadosP);
        }
        falar(item.valor);
        if (btConectado && btCarac && dadosP.comando) {
          enviarBT(dadosP.comando);
          log('↗ ' + item.valor + ' → ' + dadosP.comando, 'success');
        } else {
          log('🤲 Sinal: ' + item.valor, 'info');
        }
        await esperar(Math.round(2100 * fatorVel));
      }
    } else {
      var letra = item.valor;
      var dados = buscarLetra(letra);
      var cmd   = dados ? dados.comando : null;

      setLetraAtual(letra);
      setFeedbackModo(dados && dados.descricao ? dados.descricao : 'Soletração Libras — ' + letra);

      if (libraHand3D && libraHand3D.pronto && dados && dados.rotacoes3d) {
        libraHand3D.animarLetra(dados.rotacoes3d, dados.movimento);
      }

      falar(letra);

      if (btConectado && btCarac && cmd) {
        enviarBT(cmd);
        log('↗ ' + letra + ' → ' + cmd, 'success');
      } else {
        log('◌ ' + letra + (cmd ? ' → ' + cmd : ''), 'info');
      }

      await esperar(Math.round(450 * fatorVel));
    }

    if (abortarTraducao) break;
    marcarChip(chipIdx, 'sent');
    chipIdx++;
    await esperar(Math.round(450 * fatorVel));
  }

  if (!abortarTraducao) {
    finalizarTraducao();
  } else {
    traduzindo = false;
    atualizarBotaoTraduzir(false);
  }
}

async function traduzirGestoCompleto(palavra) {
  var dados = buscarPalavra(palavra);
  if (!dados) {
    log('ℹ Sinal composto de "' + palavra + '" não encontrado — soletrando', 'info');
    traduzirSequenciaTokens(palavra);
    return;
  }

  renderizarChips([{ tipo: 'palavra', valor: palavra }]);
  marcarChip(0, 'active');

  traduzindo      = true;
  abortarTraducao = false;
  atualizarBotaoTraduzir(true);

  var modo = dados.duas_maos ? 'Sinal com 2 mãos' : 'Sinal com 1 mão';
  setFeedbackModo(modo + ': ' + (dados.descricao || palavra));
  setLetraAtualGrande(palavra);
  log('🤲 ' + palavra + ' — ' + (dados.descricao || ''), 'info');

  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D.animarPalavra(dados);
  }

  falar(palavra);

  if (btConectado && btCarac && dados.comando) {
    enviarBT(dados.comando);
    log('↗ BT: ' + dados.comando, 'success');
  }

  var fatorVel = 1 / (velocidadeTraducao || 1.0);
  await esperar(Math.round(2400 * fatorVel));
  if (abortarTraducao) return;

  marcarChip(0, 'sent');
  if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
  setLetraAtual('✓');
  await esperar(Math.round(550 * fatorVel));

  if (!abortarTraducao) finalizarTraducao();
}

async function tratarEspaco(fatorVel) {
  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D._ativarUmaMao();
    libraHand3D.posicaoNeutra();
  }
  setLetraAtual('⎵');
  setFeedbackModo('Espaço entre palavras');
  log('⎵ Espaço entre palavras', 'info');
  if (btConectado && btCarac) enviarBT('CMD_ESPACO');
  await esperar(Math.round(650 * (fatorVel || 1)));
  if (!abortarTraducao) setLetraAtual('');
}

function finalizarTraducao() {
  traduzindo      = false;
  abortarTraducao = false;
  atualizarBotaoTraduzir(false);

  log('✓ Tradução concluída!', 'success');
  setFeedbackModo('Tradução concluída · Clique em um chip para rever');

  registrarTimeout(function() {
    if (!traduzindo && libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      setLetraAtual('');
    }
  }, 1200);

  if (btConectado && btCarac) {
    registrarTimeout(function() {
      if (!traduzindo) enviarBT('CMD_REPOUSO');
    }, 900);
  }
}

function limparCampo() {
  pararTraducaoAtiva();
  var inputEl = document.getElementById('input-texto');
  if (inputEl) inputEl.value = '';
  document.getElementById('fila-chips').innerHTML = '';
  document.querySelectorAll('.btn-letra-az').forEach(function(b) {
    b.classList.remove('active');
  });
  setLetraAtual('');
  setFeedbackModo('Aguardando entrada...');
  log('✓ Campo limpo', 'info');
  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D._ativarUmaMao();
    libraHand3D.posicaoNeutra();
  }
}

// ============================================================
// SEÇÃO 7 — CÂMERA E MEDIAPIPE HANDS (Geometria Libras Corrigida)
// ============================================================

function toggleCamera() {
  if (cameraAtiva) pararCamera();
  else             ligarCamera();
}

async function ligarCamera() {
  var btn = document.getElementById('btn-toggle-camera');
  if (btn) {
    btn.textContent = '⏳ Aguardando permissão...';
    btn.disabled = true;
  }

  var errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  var ehMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  var constraints = ehMobile
    ? [{ facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
       { facingMode: 'environment' }]
    : [{ facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }];

  var stream     = null;
  var ultimoErro = null;

  for (var i = 0; i < constraints.length; i++) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints[i] });
      break;
    } catch (e) {
      ultimoErro = e;
    }
  }

  // Se o usuário saiu da tela enquanto aguardava permissão, encerra o stream imediatamente
  if (telaAtual !== 'camera') {
    if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
    return;
  }

  if (!stream) {
    if (btn) {
      btn.textContent = '📷 Ligar Câmera';
      btn.disabled = false;
    }
    var msg = traduzirErroCameraApi(ultimoErro);
    log('✗ ' + msg, 'error');
    mostrarErroCameraUI(msg);
    return;
  }

  cameraStream = stream;
  var video = document.getElementById('cameraVideo');
  video.srcObject = cameraStream;
  await video.play();

  cameraAtiva = true;
  if (btn) {
    btn.textContent = '⏹ Desligar Câmera';
    btn.disabled = false;
  }
  log('✓ Câmera ativa — posicione a mão em frente à lente', 'success');

  iniciarReconhecimento();
}

function traduzirErroCameraApi(e) {
  if (!e) return 'Erro desconhecido ao acessar câmera.';
  switch (e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permissão de câmera negada. Permita o acesso nas configurações do navegador.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera encontrada neste dispositivo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Câmera em uso por outro aplicativo. Feche-o e tente novamente.';
    case 'OverconstrainedError':
      return 'A câmera não suporta a resolução solicitada.';
    case 'NotSupportedError':
      return 'Acesso à câmera requer conexão segura (HTTPS ou localhost).';
    default:
      return 'Erro de câmera: ' + (e.message || e.name);
  }
}

function mostrarErroCameraUI(msg) {
  var el = document.getElementById('camera-erro');
  if (el) {
    el.textContent = '⚠ ' + msg;
    el.style.display = 'block';
  }
}

function pararCamera() {
  cameraAtiva = false;
  processandoFrame = false;

  if (camRafId) {
    cancelAnimationFrame(camRafId);
    camRafId = null;
  }
  if (mpCamera) {
    try { mpCamera.stop(); } catch (e) {}
    mpCamera = null;
  }
  if (mpHands) {
    try { mpHands.close(); } catch (e) {}
    mpHands = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(t) { t.stop(); });
    cameraStream = null;
  }

  // Libera referência do MediaStream no elemento <video> (evita vazamento de memória)
  var video = document.getElementById('cameraVideo');
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  frameBufferLetra    = '';
  frameBufferContador = 0;

  var camCanvas = document.getElementById('cameraCanvas');
  if (camCanvas) {
    camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
  }

  var stab = document.getElementById('stab-fill');
  if (stab) stab.style.width = '0%';

  var errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  var btn = document.getElementById('btn-toggle-camera');
  if (btn) {
    btn.textContent = '📷 Ligar Câmera';
    btn.disabled = false;
  }
}

function iniciarReconhecimento() {
  if (typeof Hands !== 'undefined' && typeof Camera !== 'undefined') {
    iniciarMediaPipe();
  } else {
    log('ℹ MediaPipe indisponível — modo demonstração ativo', 'info');
    iniciarModoDemo();
  }
}

function iniciarMediaPipe() {
  var video     = document.getElementById('cameraVideo');
  var camCanvas = document.getElementById('cameraCanvas');
  var camCtx    = camCanvas.getContext('2d');

  mpHands = new Hands({
    locateFile: function(f) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f;
    }
  });

  mpHands.setOptions({
    maxNumHands:            1,
    modelComplexity:        1,
    minDetectionConfidence: 0.70,
    minTrackingConfidence:  0.60
  });

  mpHands.onResults(function(res) {
    if (!cameraAtiva) return;
    if (camCanvas.width  !== video.videoWidth)  camCanvas.width  = video.videoWidth  || 640;
    if (camCanvas.height !== video.videoHeight) camCanvas.height = video.videoHeight || 480;

    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
      var lm = res.multiHandLandmarks[0];
      desenharLandmarks(camCtx, lm, camCanvas.width, camCanvas.height);
      processarLandmarks(lm);
    } else {
      frameBufferContador = 0;
      atualizarResultadoCamera('', 0, 0);
    }
  });

  mpCamera = new Camera(video, {
    onFrame: async function() {
      if (!mpHands || !cameraAtiva || processandoFrame) return;
      processandoFrame = true;
      try {
        await mpHands.send({ image: video });
      } catch (e) {}
      processandoFrame = false;
    },
    width: 640,
    height: 480
  });
  mpCamera.start();
  log('✓ MediaPipe Hands ativo — reconhecimento em tempo real', 'success');
}

function desenharLandmarks(ctx, lm, w, h) {
  var CONEXOES = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ];

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.88)';
  ctx.lineWidth   = 2.6;
  CONEXOES.forEach(function(par) {
    var a = lm[par[0]], b = lm[par[1]];
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  });

  lm.forEach(function(pt, idx) {
    var isPonta = [4,8,12,16,20].indexOf(idx) >= 0;
    var isPalma = idx === 0;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, isPalma ? 7 : (isPonta ? 6 : 4), 0, Math.PI * 2);
    ctx.fillStyle = isPonta ? '#00ffea' : (isPalma ? '#ffffff' : '#00d4ff');
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 10, 20, 0.65)';
    ctx.lineWidth   = 1.2;
    ctx.stroke();
  });
  ctx.restore();
}

function processarLandmarks(lm) {
  var resultado = reconhecerConfiguracao(lm);

  if (resultado && resultado.confianca >= 0.70) {
    var letra     = resultado.letra;
    var confianca = resultado.confianca;
    var agora     = Date.now();

    if (letra === frameBufferLetra) {
      frameBufferContador = Math.min(frameBufferContador + 1, FRAMES_NECESSARIOS);
    } else {
      frameBufferLetra    = letra;
      frameBufferContador = 1;
    }

    var progressoEstabilidade = Math.round((frameBufferContador / FRAMES_NECESSARIOS) * 100);
    atualizarResultadoCamera(letra, confianca, progressoEstabilidade);

    if (frameBufferContador >= FRAMES_NECESSARIOS) {
      var novaLetra = letra !== ultimaLetra;
      var tempoOk   = (agora - tsUltimaLetra) >= DEBOUNCE_MS;

      if (novaLetra || tempoOk) {
        ultimaLetra   = letra;
        tsUltimaLetra = agora;
        falar(letra);

        // Envia comando também para a mão Bluetooth se conectada!
        var dadosL = buscarLetra(letra);
        if (btConectado && btCarac && dadosL && dadosL.comando) {
          enviarBT(dadosL.comando);
        }

        if (novaLetra) {
          var textoEl = document.getElementById('texto-detectado');
          if (textoEl) textoEl.textContent += letra;
        }
      }
    }
  } else {
    frameBufferContador = Math.max(0, frameBufferContador - 1);
    if (frameBufferContador === 0) {
      atualizarResultadoCamera('', 0, 0);
    }
  }
}

// ----------------------------------------------------------
// reconhecerConfiguracao(lm)
// Classificador geométrico invariante ao lado da mão (esquerda/direita)
// ----------------------------------------------------------
function reconhecerConfiguracao(lm) {
  var tamMao = dist2D(lm[0], lm[9]);
  if (tamMao < 0.02) return null;

  // Verifica se cada dedo (indicador a mindinho) está estendido comparando ponta, PIP e MCP
  var I  = (lm[8].y  < lm[6].y  - tamMao * 0.12) && (lm[6].y  < lm[5].y);
  var M  = (lm[12].y < lm[10].y - tamMao * 0.12) && (lm[10].y < lm[9].y);
  var A  = (lm[16].y < lm[14].y - tamMao * 0.12) && (lm[14].y < lm[13].y);
  var Mi = (lm[20].y < lm[18].y - tamMao * 0.10) && (lm[18].y < lm[17].y);

  // Polegar aberto/estendido lateralmente (invariante a mão esquerda/direita):
  // Compara a distância da ponta do polegar (4) à base do mindinho (17) vs articulação (2) à base (17)
  var distPolMind  = dist2D(lm[4], lm[17]) / tamMao;
  var distBaseMind = dist2D(lm[2], lm[17]) / tamMao;
  var distPolIndMCP = dist2D(lm[4], lm[5]) / tamMao;
  var P = (distPolMind > distBaseMind * 1.22) && (distPolIndMCP > 0.42);

  // Distâncias normalizadas importantes
  var distPI  = dist2D(lm[4], lm[8])  / tamMao; // Polegar ↔ Ponta Indicador
  var distPM  = dist2D(lm[4], lm[12]) / tamMao; // Polegar ↔ Ponta Médio
  var distIM  = dist2D(lm[8], lm[12]) / tamMao; // Ponta Indicador ↔ Ponta Médio
  var distPIP = dist2D(lm[6], lm[10]) / tamMao; // PIP Indicador ↔ PIP Médio

  // 1. Quatro dedos estendidos (B)
  if (I && M && A && Mi) {
    return { letra: 'B', confianca: 0.92 };
  }

  // 2. Indicador permanece dobrado, Médio + Anelar + Mindinho estendidos (F ou T)
  if (!I && M && A && Mi) {
    if (distPI < 0.42) return { letra: 'F', confianca: 0.86 };
    return { letra: 'T', confianca: 0.82 };
  }

  // 3. Indicador + Médio + Anelar estendidos, Mindinho fechado (W)
  if (I && M && A && !Mi) {
    return { letra: 'W', confianca: 0.89 };
  }

  // 4. Indicador + Médio estendidos, Anelar + Mindinho fechados (R, U, V, K)
  if (I && M && !A && !Mi) {
    // Letra R: dedos indicador e médio cruzados (pontas mais próximas ou invertidas em relação às bases)
    var dirBaseX  = lm[5].x - lm[9].x;
    var dirPontaX = lm[8].x - lm[12].x;
    var cruzados  = (dirBaseX * dirPontaX < 0) || (distIM < distPIP * 0.72);
    if (cruzados) {
      return { letra: 'R', confianca: 0.85 };
    }
    if (P) {
      return { letra: 'K', confianca: 0.83 };
    }
    if (distIM > 0.24) {
      return { letra: 'V', confianca: 0.90 };
    }
    return { letra: 'U', confianca: 0.88 };
  }

  // 5. Apenas Indicador estendido (L, D, G)
  if (I && !M && !A && !Mi) {
    if (P) {
      return { letra: 'L', confianca: 0.92 };
    }
    if (distPM < 0.42) {
      return { letra: 'D', confianca: 0.86 };
    }
    return { letra: 'G', confianca: 0.82 };
  }

  // 6. Apenas Mindinho estendido (Y ou I)
  if (!I && !M && !A && Mi) {
    if (P) return { letra: 'Y', confianca: 0.91 };
    return { letra: 'I', confianca: 0.89 };
  }

  // 7. Todos os 4 dedos não estão estendidos para cima (A, S, O, C, E)
  if (!I && !M && !A && !Mi) {
    // Letra O: ponta do polegar tocando ponta do indicador/médio
    if (distPI < 0.30 && distPM < 0.36) {
      return { letra: 'O', confianca: 0.86 };
    }

    // Verifica se os dedos estão totalmente fechados na palma (pontas abaixo das juntas PIP)
    var punhoFechado = (lm[8].y > lm[6].y) && (lm[12].y > lm[10].y) && (lm[16].y > lm[14].y);

    if (punhoFechado) {
      // Diferencia A (polegar na lateral) de S (polegar cruzado na frente dos dedos médios)
      var distPolMedioPIP = dist2D(lm[4], lm[10]) / tamMao;
      if (distPolMedioPIP < 0.36) {
        return { letra: 'S', confianca: 0.84 };
      }
      return { letra: 'A', confianca: 0.89 };
    }

    // Dedos semi-curvados (C ou E)
    if (distPI >= 0.30 && distPI <= 0.65 && P) {
      return { letra: 'C', confianca: 0.80 };
    }
    return { letra: 'E', confianca: 0.78 };
  }

  return null;
}

function dist2D(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function atualizarResultadoCamera(letra, confianca, estabilidadePct) {
  var elLetra = document.getElementById('letra-camera-detectada');
  if (elLetra) elLetra.textContent = letra || '—';

  var pctConf = letra ? Math.round(confianca * 100) : 0;
  var elConf = document.getElementById('lbl-confianca');
  if (elConf) {
    elConf.textContent = letra
      ? ('Confiança: ' + pctConf + '% · Estabilidade: ' + (estabilidadePct || 0) + '%')
      : 'Aguardando gesto...';
  }

  var fill = document.getElementById('conf-fill');
  if (fill) fill.style.width = pctConf + '%';

  var stab = document.getElementById('stab-fill');
  if (stab) stab.style.width = (estabilidadePct || 0) + '%';
}

function iniciarModoDemo() {
  var video     = document.getElementById('cameraVideo');
  var camCanvas = document.getElementById('cameraCanvas');
  var camCtx    = camCanvas.getContext('2d');
  var frame     = 0;
  var letrasDemo = 'ABCDEFILMORUVWY'.split('');

  function loop() {
    if (!cameraAtiva) return;
    camRafId = requestAnimationFrame(loop);
    frame++;

    camCanvas.width  = video.videoWidth  || 640;
    camCanvas.height = video.videoHeight || 480;
    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    var cx = camCanvas.width  * 0.5;
    var cy = camCanvas.height * 0.5;
    for (var i = 0; i < 21; i++) {
      var px = cx + Math.cos(i * 0.87 + frame * 0.025) * 85;
      var py = cy + Math.sin(i * 0.87 + frame * 0.020) * 80;
      camCtx.beginPath();
      camCtx.arc(px, py, i === 0 ? 7 : 4, 0, Math.PI * 2);
      camCtx.fillStyle = 'rgba(0, 212, 255, 0.65)';
      camCtx.fill();
    }

    if (frame % 95 === 0) {
      var l    = letrasDemo[Math.floor(Math.random() * letrasDemo.length)];
      var conf = 0.78 + Math.random() * 0.18;
      atualizarResultadoCamera(l, conf, 100);
      falar(l);
      var textoEl = document.getElementById('texto-detectado');
      if (textoEl) textoEl.textContent += l;
    }
  }
  loop();
}

// ============================================================
// SEÇÃO 8 — WEB SPEECH API (Com Mapa Fonético PT-BR)
// ============================================================

function falar(chave) {
  if (!vozAtiva || !('speechSynthesis' in window)) return;
  var chaveUpper = String(chave || '').toUpperCase().trim();
  var textoFala  = MAPA_FONETICO[chaveUpper] || chave.toLowerCase();
  falarTextoLivre(textoFala);
}

function falarTextoLivre(texto) {
  if (!vozAtiva || !('speechSynthesis' in window) || !texto) return;
  window.speechSynthesis.cancel();

  var utt    = new SpeechSynthesisUtterance(texto);
  utt.lang   = 'pt-BR';
  utt.rate   = Math.min(Math.max(0.92 * velocidadeTraducao, 0.7), 1.4);
  utt.pitch  = 1.0;
  utt.volume = 1.0;

  var vozes = window.speechSynthesis.getVoices();
  for (var i = 0; i < vozes.length; i++) {
    if (vozes[i].lang && vozes[i].lang.toLowerCase().indexOf('pt') === 0) {
      utt.voice = vozes[i];
      break;
    }
  }

  window.speechSynthesis.speak(utt);
}

// ============================================================
// SEÇÃO 9 — BLUETOOTH BLE (Sem vazamento de listeners)
// ============================================================

function onBtDisconnected() {
  btConectado  = false;
  btConectando = false;
  btCarac      = null;
  atualizarBTUI('disconnected', 'Desconectado');
  log('✗ Bluetooth desconectado', 'error');
}

async function conectarBluetooth() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth não suportado neste navegador.\nUse Google Chrome ou Edge no Android/Desktop.');
    log('✗ Web Bluetooth indisponível neste navegador', 'error');
    return;
  }
  if (btConectando) return;

  btConectando = true;
  atualizarBTUI('connecting', 'Conectando...');
  log('🔍 Procurando ESP32 LibraTronic...', 'info');

  try {
    if (btDevice) {
      btDevice.removeEventListener('gattserverdisconnected', onBtDisconnected);
    }

    btDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'LibraTronic' },
        { services: [BT_UUID_SERVICO] }
      ],
      optionalServices: [BT_UUID_SERVICO]
    });

    btDevice.addEventListener('gattserverdisconnected', onBtDisconnected);

    log('✓ Dispositivo localizado: ' + (btDevice.name || 'ESP32'), 'success');
    var servidor = await btDevice.gatt.connect();
    var servico  = await servidor.getPrimaryService(BT_UUID_SERVICO);
    btCarac      = await servico.getCharacteristic(BT_UUID_CARAC);

    btConectado  = true;
    btConectando = false;
    atualizarBTUI('connected', btDevice.name || 'LibraTronic');
    log('✓ Bluetooth BLE conectado com sucesso!', 'success');

  } catch (e) {
    btConectando = false;
    atualizarBTUI('disconnected', 'Desconectado');
    if (e && e.message && e.message.indexOf('cancelled') >= 0) {
      log('ℹ Busca Bluetooth cancelada pelo usuário', 'info');
    } else {
      log('✗ Erro BT: ' + (e.message || e), 'error');
    }
  }
}

function desconectarBluetooth() {
  if (btDevice) {
    btDevice.removeEventListener('gattserverdisconnected', onBtDisconnected);
    if (btDevice.gatt && btDevice.gatt.connected) {
      btDevice.gatt.disconnect();
    }
  }
  btConectado  = false;
  btConectando = false;
  btCarac      = null;
  atualizarBTUI('disconnected', 'Desconectado');
  log('✓ Bluetooth desconectado', 'info');
}

async function enviarBT(comando) {
  if (!btCarac || !btConectado) return;
  try {
    var bytes = new TextEncoder().encode('<' + comando + '>');
    await btCarac.writeValue(bytes);
  } catch (e) {
    log('✗ Falha no envio BT: ' + (e.message || e), 'error');
    onBtDisconnected();
  }
}

function atualizarBTUI(estado, texto) {
  document.querySelectorAll('.bt-dot').forEach(function(el) {
    el.className = 'bt-dot' +
      (estado === 'connected'  ? ' connected'  : '') +
      (estado === 'connecting' ? ' connecting' : '');
  });
  document.querySelectorAll('.bt-status-text').forEach(function(el) {
    el.textContent = texto;
  });
  var nomeEl = document.getElementById('bt-device-name');
  if (nomeEl) nomeEl.textContent = texto;
}

// ============================================================
// SEÇÃO 10 — FEEDBACK VISUAL E CHIPS INTERATIVOS
// ============================================================

function renderizarChips(itens) {
  var c = document.getElementById('fila-chips');
  if (!c) return;
  c.innerHTML = '';

  for (var i = 0; i < itens.length; i++) {
    (function(idx, item) {
      var valor = typeof item === 'string' ? item : item.valor;
      var tipo  = typeof item === 'string' ? 'letra' : item.tipo;

      var d = document.createElement('div');
      d.className   = 'chip clickable';
      d.textContent = valor;
      d.id          = 'chip-' + idx;
      d.title       = 'Clique para visualizar "' + valor + '" na mão 3D';

      d.addEventListener('click', function() {
        if (traduzindo) pararTraducaoAtiva();
        document.querySelectorAll('#fila-chips .chip').forEach(function(ch) {
          ch.classList.remove('active');
        });
        d.classList.add('active');
        if (tipo === 'palavra') {
          var dp = buscarPalavra(valor);
          if (dp && libraHand3D && libraHand3D.pronto) {
            setLetraAtualGrande(valor);
            setFeedbackModo(dp.descricao || valor);
            libraHand3D.animarPalavra(dp);
            falar(valor);
          }
        } else {
          visualizarLetraUnica3D(valor);
        }
      });

      c.appendChild(d);
    })(i, itens[i]);
  }
}

function marcarChip(idx, estado) {
  var el = document.getElementById('chip-' + idx);
  if (!el) return;
  el.classList.remove('active', 'sent');
  if (estado) el.classList.add(estado);
}

function setLetraAtual(texto) {
  var el = document.getElementById('letra-atual');
  if (!el) return;
  el.textContent    = texto;
  el.style.fontSize = '2.6rem';
}

function setLetraAtualGrande(texto) {
  var el = document.getElementById('letra-atual');
  if (!el) return;
  el.textContent    = texto;
  el.style.fontSize = texto.length > 6 ? '1.35rem' : '1.85rem';
}

function setFeedbackModo(texto) {
  var el = document.getElementById('feedback-modo');
  if (!el) return;
  el.textContent = texto;
}

function log(msg, tipo) {
  var box = document.getElementById('log-box');
  if (!box) return;
  var d = document.createElement('div');
  d.className = 'log-line ' + (tipo || 'info');
  var h = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  d.textContent = '[' + h + '] ' + msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 50) box.removeChild(box.firstChild);
}

function esperar(ms) {
  return new Promise(function(res) {
    registrarTimeout(res, ms);
  });
}

// ============================================================
// SEÇÃO 11 — BANCO FALLBACK EMBUTIDO (Sincronizado com database.json)
// ============================================================
function getBancoFallback() {
  var R = {
    A: { c:'CMD_A', d:'Punho fechado com polegar na lateral', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.15,y:0.15,z:-0.22,midX:0.10},indicador:{x:1.58,y:0,z:0.03,midX:1.65,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.58,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    B: { c:'CMD_B', d:'Quatro dedos estendidos e polegar na palma', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.85,y:-0.35,z:0.42,midX:0.95},indicador:{x:0.02,y:0,z:0.02,midX:0.02,distX:0.02},medio:{x:0.02,y:0,z:0,midX:0.02,distX:0.02},anelar:{x:0.02,y:0,z:-0.02,midX:0.02,distX:0.02},mindinho:{x:0.02,y:0,z:-0.05,midX:0.02,distX:0.02}}},
    C: { c:'CMD_C', d:'Dedos e polegar curvados em arco C', r:{pulso:{x:0,y:-0.45,z:0},polegar:{x:0.55,y:-0.35,z:-0.65,midX:0.55},indicador:{x:0.65,y:0,z:0.04,midX:0.85,distX:0.65},medio:{x:0.68,y:0,z:0,midX:0.88,distX:0.65},anelar:{x:0.68,y:0,z:-0.04,midX:0.88,distX:0.65},mindinho:{x:0.65,y:0,z:-0.08,midX:0.85,distX:0.60}}},
    D: { c:'CMD_D', d:'Indicador estendido, demais tocando polegar', r:{pulso:{x:0,y:-0.25,z:0},polegar:{x:0.65,y:-0.30,z:-0.25,midX:0.55},indicador:{x:0.02,y:0,z:0.02,midX:0.02,distX:0.02},medio:{x:1.15,y:0,z:0,midX:1.20,distX:0.90},anelar:{x:1.25,y:0,z:-0.03,midX:1.30,distX:0.95},mindinho:{x:1.30,y:0,z:-0.06,midX:1.35,distX:1.00}}},
    E: { c:'CMD_E', d:'Dedos curvados nas falanges superiores', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.90,y:-0.30,z:0.28,midX:0.95},indicador:{x:0.45,y:0,z:0.03,midX:1.55,distX:1.35},medio:{x:0.45,y:0,z:0,midX:1.55,distX:1.35},anelar:{x:0.45,y:0,z:-0.03,midX:1.55,distX:1.35},mindinho:{x:0.45,y:0,z:-0.06,midX:1.55,distX:1.35}}},
    F: { c:'CMD_F', d:'Indicador tocando polegar por fora, 3 dedos abertos', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.45,y:-0.15,z:-0.30,midX:0.25},indicador:{x:1.05,y:0,z:0.08,midX:0.95,distX:0.55},medio:{x:0.04,y:0,z:0,midX:0.04,distX:0.02},anelar:{x:0.04,y:0,z:-0.05,midX:0.04,distX:0.02},mindinho:{x:0.04,y:0,z:-0.12,midX:0.04,distX:0.02}}},
    G: { c:'CMD_G', d:'Indicador e polegar paralelos apontando para cima', r:{pulso:{x:0,y:-0.35,z:0},polegar:{x:0.15,y:0.10,z:-0.25,midX:0.05},indicador:{x:0.02,y:0,z:0.02,midX:0.02,distX:0.02},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    H: { c:'CMD_H', m:'giro_pulso', d:'Indicador, médio e polegar com giro de pulso', r:{pulso:{x:0,y:-0.40,z:0},polegar:{x:0.45,y:-0.15,z:-0.25,midX:0.35},indicador:{x:0.02,y:0,z:0.16,midX:0.02,distX:0.02},medio:{x:0.20,y:0,z:-0.14,midX:0.10,distX:0.05},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    I: { c:'CMD_I', d:'Apenas dedo mínimo estendido', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.70,y:-0.20,z:0.15,midX:0.65},indicador:{x:1.60,y:0,z:0.03,midX:1.65,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:0.02,y:0,z:-0.05,midX:0.02,distX:0.02}}},
    J: { c:'CMD_J', m:'tracar_j', d:'Dedo mínimo traçando a curva do J no ar', r:{pulso:{x:0.15,y:-0.35,z:0.25},polegar:{x:0.70,y:-0.20,z:0.15,midX:0.65},indicador:{x:1.60,y:0,z:0.03,midX:1.65,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:0.02,y:0,z:-0.05,midX:0.02,distX:0.02}}},
    K: { c:'CMD_K', m:'impulso_cima', d:'Indicador e médio com polegar entre eles impulsionando p/ cima', r:{pulso:{x:-0.15,y:-0.25,z:0},polegar:{x:0.35,y:-0.15,z:-0.22,midX:0.20},indicador:{x:0.02,y:0,z:0.12,midX:0.02,distX:0.02},medio:{x:0.55,y:0,z:-0.12,midX:0.15,distX:0.05},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    L: { c:'CMD_L', d:'Indicador e polegar formando ângulo reto (L)', r:{pulso:{x:0,y:0,z:0},polegar:{x:0,y:0.20,z:-1.35,midX:0},indicador:{x:0.02,y:0,z:0.02,midX:0.02,distX:0.02},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    M: { c:'CMD_M', d:'Três dedos unidos apontando para baixo', r:{pulso:{x:0.35,y:0,z:0},polegar:{x:0.85,y:-0.35,z:0.35,midX:0.85},indicador:{x:0.95,y:0,z:0.03,midX:0.45,distX:0.25},medio:{x:0.95,y:0,z:0,midX:0.45,distX:0.25},anelar:{x:0.95,y:0,z:-0.03,midX:0.45,distX:0.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    N: { c:'CMD_N', d:'Dois dedos unidos apontando para baixo', r:{pulso:{x:0.35,y:0,z:0},polegar:{x:0.85,y:-0.35,z:0.25,midX:0.85},indicador:{x:0.95,y:0,z:0.03,midX:0.45,distX:0.25},medio:{x:0.95,y:0,z:0,midX:0.45,distX:0.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    O: { c:'CMD_O', d:'Dedos curvados formando um círculo com o polegar', r:{pulso:{x:0,y:-0.45,z:0},polegar:{x:0.72,y:-0.40,z:-0.42,midX:0.70},indicador:{x:0.95,y:0,z:0.04,midX:1.15,distX:0.85},medio:{x:0.98,y:0,z:0,midX:1.18,distX:0.85},anelar:{x:0.95,y:0,z:-0.04,midX:1.15,distX:0.85},mindinho:{x:0.90,y:0,z:-0.08,midX:1.10,distX:0.80}}},
    P: { c:'CMD_P', d:'Configuração de K inclinada na horizontal', r:{pulso:{x:0.95,y:-0.35,z:-0.25},polegar:{x:0.35,y:-0.15,z:-0.22,midX:0.20},indicador:{x:0.02,y:0,z:0.12,midX:0.02,distX:0.02},medio:{x:0.65,y:0,z:-0.10,midX:0.15,distX:0.05},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    Q: { c:'CMD_Q', d:'Configuração de G apontando para baixo', r:{pulso:{x:1.15,y:0,z:0},polegar:{x:0.20,y:0.10,z:-0.25,midX:0.05},indicador:{x:0.15,y:0,z:0.02,midX:0.05,distX:0.02},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    R: { c:'CMD_R', d:'Indicador e médio estendidos e cruzados', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.85,y:-0.25,z:0.25,midX:0.80},indicador:{x:0.08,y:0.15,z:-0.18,midX:0.05,distX:0.05},medio:{x:-0.04,y:-0.15,z:0.18,midX:0.12,distX:0.08},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    S: { c:'CMD_S', d:'Punho fechado com polegar cruzado à frente', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.75,y:-0.35,z:0.28,midX:0.85},indicador:{x:1.60,y:0,z:0.03,midX:1.65,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    T: { c:'CMD_T', d:'Indicador flexionado por trás do polegar, 3 dedos estendidos', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.55,y:-0.10,z:-0.10,midX:0.25},indicador:{x:1.10,y:0,z:-0.05,midX:1.05,distX:0.65},medio:{x:0.04,y:0,z:0,midX:0.04,distX:0.02},anelar:{x:0.04,y:0,z:-0.05,midX:0.04,distX:0.02},mindinho:{x:0.04,y:0,z:-0.12,midX:0.04,distX:0.02}}},
    U: { c:'CMD_U', d:'Indicador e médio estendidos e unidos', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.85,y:-0.25,z:0.25,midX:0.85},indicador:{x:0.02,y:0,z:-0.04,midX:0.02,distX:0.02},medio:{x:0.02,y:0,z:0.04,midX:0.02,distX:0.02},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    V: { c:'CMD_V', d:'Indicador e médio estendidos e afastados em V', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.85,y:-0.25,z:0.25,midX:0.85},indicador:{x:0.02,y:0,z:0.24,midX:0.02,distX:0.02},medio:{x:0.02,y:0,z:-0.22,midX:0.02,distX:0.02},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    W: { c:'CMD_W', d:'Três dedos estendidos e separados em W', r:{pulso:{x:0,y:0,z:0},polegar:{x:0.85,y:-0.25,z:0.30,midX:0.85},indicador:{x:0.02,y:0,z:0.26,midX:0.02,distX:0.02},medio:{x:0.02,y:0,z:0,midX:0.02,distX:0.02},anelar:{x:0.02,y:0,z:-0.26,midX:0.02,distX:0.02},mindinho:{x:1.60,y:0,z:-0.08,midX:1.65,distX:1.25}}},
    X: { c:'CMD_X', m:'puxar_x', d:'Indicador em gancho puxando levemente', r:{pulso:{x:0,y:-0.35,z:0},polegar:{x:0.70,y:-0.20,z:0.15,midX:0.65},indicador:{x:0.25,y:0,z:0.02,midX:1.45,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}},
    Y: { c:'CMD_Y', d:'Polegar e dedo mínimo estendidos', r:{pulso:{x:0,y:0,z:0},polegar:{x:0,y:0.20,z:-1.35,midX:0},indicador:{x:1.60,y:0,z:0.03,midX:1.65,distX:1.25},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:0.02,y:0,z:-0.18,midX:0.02,distX:0.02}}},
    Z: { c:'CMD_Z', m:'tracar_z', d:'Indicador traçando a letra Z no ar', r:{pulso:{x:0.10,y:0,z:0},polegar:{x:0.75,y:-0.25,z:0.20,midX:0.75},indicador:{x:0.02,y:0,z:0.02,midX:0.02,distX:0.02},medio:{x:1.60,y:0,z:0,midX:1.65,distX:1.25},anelar:{x:1.60,y:0,z:-0.03,midX:1.65,distX:1.25},mindinho:{x:1.60,y:0,z:-0.06,midX:1.65,distX:1.25}}}
  };

  var letras = {};
  Object.keys(R).forEach(function(k) {
    letras[k] = {
      comando: R[k].c,
      descricao: R[k].d,
      movimento: R[k].m || null,
      rotacoes3d: R[k].r
    };
  });

  return {
    letras: letras,
    palavras: {
      AJUDA:       { duas_maos:true,  comando:'CMD_AJUDA',    movimento:'ajuda',          descricao:'Mão aberta apoiando e impulsionando a outra para frente', mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:{rotacoes3d: R.B.r} },
      OBRIGADO:    { duas_maos:false, comando:'CMD_OBRIGADO', movimento:'obrigado',       descricao:'Mão em B partindo da testa/queixo para frente',           mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:null },
      AGUA:        { duas_maos:false, comando:'CMD_AGUA',     movimento:'agua_libras',    descricao:'Mão em L (Libras oficial) com indicador batendo duas vezes', mao_direita:{rotacoes3d: R.L.r}, mao_esquerda:null },
      BANHEIRO:    { duas_maos:false, comando:'CMD_BANHEIRO', movimento:'oscilar_pulso',  descricao:'Sinal de banheiro com oscilação lateral',                 mao_direita:{rotacoes3d: R.T.r}, mao_esquerda:null },
      SOCORRO:     { duas_maos:true,  comando:'CMD_SOCORRO',  movimento:'alerta_duplo',   descricao:'Ambas as mãos em alerta pedindo socorro',                 mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:{rotacoes3d: R.B.r} },
      COMIDA:      { duas_maos:false, comando:'CMD_COMIDA',   movimento:'comida_libras',  descricao:'Dedos unidos em pinça levando à boca',                    mao_direita:{rotacoes3d: R.O.r}, mao_esquerda:null },
      PERIGO:      { duas_maos:true,  comando:'CMD_PERIGO',   movimento:'perigo',         descricao:'Sinal de perigo/cuidado com movimento de alerta',         mao_direita:{rotacoes3d: R.Y.r}, mao_esquerda:{rotacoes3d: R.Y.r} },
      'POR FAVOR': { duas_maos:false, comando:'CMD_PORFAVOR', movimento:'circular_peito', descricao:'Mão aberta fazendo movimento circular no peito',          mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:null },
      SIM:         { duas_maos:false, comando:'CMD_SIM',      movimento:'sim_aceno',      descricao:'Punho em S acenando positivamente',                       mao_direita:{rotacoes3d: R.S.r}, mao_esquerda:null },
      NAO:         { duas_maos:false, comando:'CMD_NAO',      movimento:'nao_abano',      descricao:'Indicador estendido abanando negativamente',              mao_direita:{rotacoes3d: R.D.r}, mao_esquerda:null }
    },
    configuracoes: { intervaloBetweenLetras: 900, tempoTransicao3d: 650, debounceCamera: 1800 }
  };
}
