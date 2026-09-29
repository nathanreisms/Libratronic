// ============================================================
// script.js — LibraTronic v3
// Tradução Libras oficial · Câmera MediaPipe · Web Speech API
// Debounce · Palavras-chave com gestos reais · Bluetooth BLE
// ============================================================

// ============================================================
// SEÇÃO 1 — ESTADO GLOBAL
// ============================================================

// Palavras que ativam gesto completo (NÃO soletra)
var PALAVRAS_CHAVE = [
  'AJUDA','OBRIGADO','AGUA','BANHEIRO','SOCORRO',
  'COMIDA','PERIGO','POR FAVOR','SIM','NAO'
];

var bancoDados   = null;   // dados do database.json

// ── BLUETOOTH ──────────────────────────────────────────────
var btDevice     = null;
var btCarac      = null;
var btConectado  = false;
var btConectando = false;
var BT_UUID_SERVICO = '0000ffe0-0000-1000-8000-00805f9b34fb';
var BT_UUID_CARAC   = '0000ffe1-0000-1000-8000-00805f9b34fb';

// ── TRADUÇÃO ───────────────────────────────────────────────
var traduzindo      = false;
var abortarTraducao = false;

// ── CÂMERA E BUFFER DE ESTABILIDADE ────────────────────────
var cameraStream = null;   // MediaStream ativo
var cameraAtiva  = false;
var camRafId     = null;   // loop do modo simulado
var mpHands      = null;   // instância MediaPipe Hands
var mpCamera     = null;   // instância MediaPipe Camera

var frameBufferLetra = ''; // Buffer para estabilizar a letra
var frameBufferContador = 0;
var FRAMES_NECESSARIOS = 15; // Exige 15 frames iguais antes de registrar a letra

// ── DEBOUNCE DE RECONHECIMENTO ─────────────────────────────
// Evita repetir o áudio da mesma letra continuamente
var ultimaLetra        = '';   // última letra falada
var tsUltimaLetra      = 0;    // timestamp do último disparo
var DEBOUNCE_MS        = 2000; // intervalo mínimo (ms)

// ============================================================
// SEÇÃO 2 — INICIALIZAÇÃO DO DOM
// ============================================================

document.addEventListener('DOMContentLoaded', function() {

  carregarBanco();   // carrega database.json
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
      pararCamera();
      if (libraHand3D) { libraHand3D.destruir(); libraHand3D = null; }
      mostrarTela('home');
    });
  });

  // ── TELA TEXTO ──
  document.getElementById('btn-traduzir').addEventListener('click', iniciarTraducao);
  document.getElementById('btn-limpar').addEventListener('click', limparCampo);

  // Enter no textarea = traduzir
  document.getElementById('input-texto').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); iniciarTraducao(); }
  });

  // Força maiúsculo e filtra caracteres inválidos (com suporte a remoção de acentos)
  document.getElementById('input-texto').addEventListener('input', function() {
    var pos = this.selectionStart;
    this.value = this.value
      .normalize('NFD')                     // Separa letras de acentos
      .replace(/[\u0300-\u036f]/g, '')      // Remove as marcas de acento
      .toUpperCase()                        // Força caixa alta
      .replace(/[^A-Z \n]/g, '');           // Mantém apenas A-Z, espaços e quebras
    try { this.setSelectionRange(pos, pos); } catch(e) {}
  });

  // ── CONTROLES 3D ──
  document.getElementById('btn-3d-rotacionar').addEventListener('click', toggle3DRotacao);
  document.getElementById('btn-3d-resetar').addEventListener('click', resetar3DCamera);

  // ── GESTOS RÁPIDOS ──
  document.querySelectorAll('.btn-palavra').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.getElementById('input-texto').value = btn.getAttribute('data-p');
      iniciarTraducao();
    });
  });

  // ── CÂMERA ──
  document.getElementById('btn-toggle-camera').addEventListener('click', toggleCamera);
  document.getElementById('btn-limpar-cam').addEventListener('click', function() {
    document.getElementById('texto-detectado').textContent = '';
    document.getElementById('conf-fill').style.width = '0%';
    var elConf = document.getElementById('lbl-confianca');
    if (elConf) elConf.textContent = '';
    var elLetra = document.getElementById('letra-camera-detectada');
    if (elLetra) elLetra.textContent = '—';
  });

  // ── BLUETOOTH ──
  document.getElementById('btn-bt-conectar').addEventListener('click', conectarBluetooth);
  document.getElementById('btn-bt-desconectar').addEventListener('click', desconectarBluetooth);
});

// ============================================================
// SEÇÃO 3 — NAVEGAÇÃO
// ============================================================

function mostrarTela(id) {
  abortarTraducao = true;
  traduzindo      = false;

  document.querySelectorAll('.screen').forEach(function(t) {
    t.classList.remove('active');
  });

  setTimeout(function() {
    var tela = document.getElementById('screen-' + id);
    if (tela) tela.classList.add('active');
    if (id === 'text') setTimeout(inicializar3D, 380);
  }, 45);
}

// ============================================================
// SEÇÃO 4 — BANCO DE DADOS
// ============================================================

function carregarBanco() {
  fetch('./database.json')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      bancoDados = d;
      if (d.configuracoes && d.configuracoes.debounceCamera) {
        DEBOUNCE_MS = d.configuracoes.debounceCamera;
      }
      log('✓ Banco carregado — 26 letras + ' +
          Object.keys(d.palavras || {}).length + ' gestos Libras', 'success');
    })
    .catch(function() {
      bancoDados = getBancoFallback();
      log('ℹ Banco embutido ativo', 'info');
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

function detectarPalavraChave(texto) {
  var t = texto.trim().toUpperCase();
  for (var i = 0; i < PALAVRAS_CHAVE.length; i++) {
    if (t === PALAVRAS_CHAVE[i]) return PALAVRAS_CHAVE[i];
  }
  return null;
}

// ============================================================
// SEÇÃO 5 — MOTOR 3D
// ============================================================

function inicializar3D() {
  if (typeof THREE === 'undefined') {
    log('⚠ Three.js não carregado — verifique a CDN', 'error');
    return;
  }
  if (libraHand3D) { libraHand3D.destruir(); libraHand3D = null; }

  libraHand3D = new LibraHand3D('hand3d-container');
  libraHand3D.setUp();

  if (window.removerLoading3D) setTimeout(window.removerLoading3D, 300);
  log('✓ Mão robótica 3D inicializada', 'success');
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
  if (libraHand3D) libraHand3D.resetarCamera();
}

// ============================================================
// SEÇÃO 6 — TRADUÇÃO POR TEXTO
// ============================================================

function iniciarTraducao() {
  if (traduzindo) {
    abortarTraducao = true;
    traduzindo      = false;
    var b = document.getElementById('btn-traduzir');
    if (b) b.textContent = '▶ Traduzir';
    log('⏹ Tradução interrompida', 'info');
    return;
  }

  var inputEl = document.getElementById('input-texto');
  var texto   = inputEl ? inputEl.value.trim().toUpperCase() : '';
  if (!texto) { log('⚠ Digite algum texto!', 'error'); return; }

  var pk = detectarPalavraChave(texto);
  if (pk) {
    traduzirGestoCompleto(pk);
  } else {
    traduzirSoletrado(texto);
  }
}

async function traduzirSoletrado(texto) {
  var tokens = [];
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (/[A-Z]/.test(c) || c === ' ') tokens.push(c);
  }

  var letras = tokens.filter(function(t) { return t !== ' '; });
  if (letras.length === 0) { log('⚠ Nenhuma letra válida!', 'error'); return; }

  renderizarChips(letras);

  traduzindo      = true;
  abortarTraducao = false;

  var btnT = document.getElementById('btn-traduzir');
  if (btnT) btnT.textContent = '⏹ Parar';

  log('▶ Soletração: "' + texto + '"', 'info');
  setFeedbackModo('Soletração Libras — letra a letra');

  if (libraHand3D && libraHand3D.pronto) libraHand3D._ativarUmaMao();

  var chipIdx = 0;

  for (var t = 0; t < tokens.length; t++) {
    if (abortarTraducao) break;

    var token = tokens[t];

    if (token === ' ') {
      await tratarEspaco();
      continue;
    }

    var letra = token;
    var dados = buscarLetra(letra);
    var cmd   = dados ? dados.comando : null;

    marcarChip(chipIdx, 'active');
    setLetraAtual(letra);

    if (libraHand3D && libraHand3D.pronto && dados && dados.rotacoes3d) {
      libraHand3D.animarLetra(dados.rotacoes3d);
    }

    falar(letra);

    if (btConectado && btCarac && cmd) {
      enviarBT(cmd);
      log('↗ ' + letra + ' → ' + cmd, 'success');
    } else {
      log('◌ ' + letra + (cmd ? ' → ' + cmd : ''), 'info');
    }

    await esperar(400);
    if (abortarTraducao) break;
    marcarChip(chipIdx, 'sent');
    chipIdx++;
    await esperar(500);
  }

  if (!abortarTraducao) {
    finalizarTraducao();
  } else {
    traduzindo = false;
    if (btnT) btnT.textContent = '▶ Traduzir';
  }
}

async function traduzirGestoCompleto(palavra) {
  var dados = buscarPalavra(palavra);
  if (!dados) {
    log('ℹ Gesto de "' + palavra + '" não encontrado — soletração', 'info');
    traduzirSoletrado(palavra);
    return;
  }

  traduzindo      = true;
  abortarTraducao = false;

  var btnT = document.getElementById('btn-traduzir');
  if (btnT) btnT.textContent = '⏹ Parar';

  var modo = dados.duas_maos ? 'Gesto com duas mãos' : 'Gesto com uma mão';
  setFeedbackModo(modo + ' — ' + palavra);
  setLetraAtualGrande(palavra);
  log('🤲 ' + palavra + ' — ' + (dados.descricao || ''), 'info');

  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D.animarPalavra(dados);
  }

  falar(palavra.toLowerCase());

  if (btConectado && btCarac && dados.comando) {
    enviarBT(dados.comando);
    log('↗ BT: ' + dados.comando, 'success');
  }

  await esperar(2500);

  if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
  setLetraAtual('✓');
  await esperar(700);

  finalizarTraducao();
}

async function tratarEspaco() {
  if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
  setLetraAtual('⎵');
  setFeedbackModo('Espaço — pausa');
  log('⎵ Espaço entre palavras', 'info');
  if (btConectado && btCarac) enviarBT('CMD_ESPACO');
  await esperar(800);
  setLetraAtual('');
}

function finalizarTraducao() {
  traduzindo      = false;
  abortarTraducao = false;

  var btnT = document.getElementById('btn-traduzir');
  if (btnT) btnT.textContent = '▶ Traduzir';

  log('✓ Tradução concluída!', 'success');
  setFeedbackModo('Aguardando entrada...');

  setTimeout(function() {
    if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
    setLetraAtual('');
  }, 1500);

  if (btConectado && btCarac) {
    setTimeout(function() { enviarBT('CMD_REPOUSO'); }, 1000);
  }
}

function limparCampo() {
  abortarTraducao = true;
  traduzindo      = false;
  var inputEl = document.getElementById('input-texto');
  if (inputEl) inputEl.value = '';
  document.getElementById('fila-chips').innerHTML = '';
  setLetraAtual('');
  setFeedbackModo('Aguardando entrada...');
  log('✓ Campo limpo', 'info');
  if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
  var b = document.getElementById('btn-traduzir');
  if (b) b.textContent = '▶ Traduzir';
}

// ============================================================
// SEÇÃO 7 — CÂMERA E MEDIAPIPE HANDS
// ============================================================

function toggleCamera() {
  if (cameraAtiva) pararCamera();
  else             ligarCamera();
}

async function ligarCamera() {
  var btn = document.getElementById('btn-toggle-camera');
  if (btn) { btn.textContent = '⏳ Aguardando permissão...'; btn.disabled = true; }

  var errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  var ehMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  var constraints = ehMobile
    ? [{ facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
       { facingMode: 'user' }]
    : [{ facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }];

  var stream = null;
  var ultimoErro = null;

  for (var i = 0; i < constraints.length; i++) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints[i] });
      break; 
    } catch (e) {
      ultimoErro = e;
    }
  }

  if (!stream) {
    if (btn) { btn.textContent = '📷 Ligar Câmera'; btn.disabled = false; }
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
  if (btn) { btn.textContent = '⏹ Desligar Câmera'; btn.disabled = false; }
  log('✓ Câmera ativa (' + (ehMobile ? 'traseira/frontal' : 'webcam') + ')', 'success');

  iniciarReconhecimento();
}

function traduzirErroCameraApi(e) {
  if (!e) return 'Erro desconhecido ao acessar câmera.';
  switch (e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permissão de câmera negada. Permita o acesso nas configurações do browser.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nenhuma câmera encontrada no dispositivo.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Câmera em uso por outro aplicativo. Feche-o e tente novamente.';
    case 'OverconstrainedError':
      return 'Câmera não suporta a resolução solicitada.';
    case 'NotSupportedError':
      return 'Câmera não suportada neste browser. Use Chrome.';
    default:
      return 'Erro de câmera: ' + (e.message || e.name);
  }
}

function mostrarErroCameraUI(msg) {
  var el = document.getElementById('camera-erro');
  if (el) { el.textContent = '⚠ ' + msg; el.style.display = 'block'; }
}

function pararCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(t) { t.stop(); });
    cameraStream = null;
  }
  if (camRafId) { cancelAnimationFrame(camRafId); camRafId = null; }
  if (mpCamera) { try { mpCamera.stop(); } catch(e) {} mpCamera = null; }
  if (mpHands)  { try { mpHands.close(); } catch(e) {} mpHands = null; } // Previne memory leak

  cameraAtiva = false;
  frameBufferLetra = '';
  frameBufferContador = 0;

  var camCanvas = document.getElementById('cameraCanvas');
  if (camCanvas) {
    camCanvas.getContext('2d').clearRect(0, 0, camCanvas.width, camCanvas.height);
  }
  var errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  var btn = document.getElementById('btn-toggle-camera');
  if (btn) { btn.textContent = '📷 Ligar Câmera'; btn.disabled = false; }

  log('⏹ Câmera desligada', 'info');
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
    minDetectionConfidence: 0.72,
    minTrackingConfidence:  0.60,
  });

  mpHands.onResults(function(res) {
    if (camCanvas.width  !== video.videoWidth)  camCanvas.width  = video.videoWidth  || 640;
    if (camCanvas.height !== video.videoHeight) camCanvas.height = video.videoHeight || 480;

    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
      var lm = res.multiHandLandmarks[0];
      desenharLandmarks(camCtx, lm, camCanvas.width, camCanvas.height);
      processarLandmarks(lm);
    } else {
      frameBufferContador = 0;
      atualizarResultadoCamera('', 0); 
    }
  });

  mpCamera = new Camera(video, {
    onFrame: async function() {
      if (mpHands && cameraAtiva) await mpHands.send({ image: video });
    },
    width: 640, height: 480,
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
    [5,9],[9,13],[13,17],           
  ];

  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.85)';
  ctx.lineWidth   = 2.5;
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
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  });
  ctx.restore();
}

// Estabilizador para evitar flicker no MediaPipe
function processarLandmarks(lm) {
  var resultado = reconhecerConfiguracao(lm);

  // Exige confiança superior a 75%
  if (resultado && resultado.confianca > 0.75) {
    var letra     = resultado.letra;
    var confianca = resultado.confianca;
    var agora     = Date.now();

    if (letra === frameBufferLetra) {
      frameBufferContador++;
    } else {
      frameBufferLetra = letra;
      frameBufferContador = 1;
    }

    // A letra se estabilizou no buffer
    if (frameBufferContador >= FRAMES_NECESSARIOS) {
      atualizarResultadoCamera(letra, confianca);

      var novaLetra   = letra !== ultimaLetra;
      var tempoOk     = (agora - tsUltimaLetra) >= DEBOUNCE_MS;

      if (novaLetra || tempoOk) {
        ultimaLetra   = letra;
        tsUltimaLetra = agora;
        falar(letra);

        if (novaLetra) {
          var textoEl = document.getElementById('texto-detectado');
          if (textoEl) textoEl.textContent += letra;
        }
      }
    }
  } else {
    frameBufferContador = 0;
    atualizarResultadoCamera('', 0);
  }
}

function reconhecerConfiguracao(lm) {
  var polEst = lm[4].x  < lm[3].x;   
  var indEst = lm[8].y  < lm[6].y;   
  var medEst = lm[12].y < lm[10].y;  
  var aneEst = lm[16].y < lm[14].y;  
  var minEst = lm[20].y < lm[18].y;  

  var dx = lm[4].x - lm[8].x;
  var dy = lm[4].y - lm[8].y;
  var distPI   = Math.sqrt(dx * dx + dy * dy);
  var tamMao   = Math.sqrt(Math.pow(lm[0].x - lm[9].x, 2) + Math.pow(lm[0].y - lm[9].y, 2));
  var distNorm = tamMao > 0 ? distPI / tamMao : 1;

  var dx2 = lm[8].x - lm[12].x;
  var dy2 = lm[8].y - lm[12].y;
  var distIM   = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  var distIMN  = tamMao > 0 ? distIM / tamMao : 1;

  var indCurv = lm[8].y  - lm[5].y;  
  var medCurv = lm[12].y - lm[9].y;

  var P = polEst, I = indEst, M = medEst, A = aneEst, Mi = minEst;

  if (!P && !I && !M && !A && !Mi && distNorm > 0.25) return { letra: 'A', confianca: 0.88 };
  if (!P && I && M && A && Mi) return { letra: 'B', confianca: 0.90 };
  if (P && I && !M && !A && !Mi) return { letra: 'L', confianca: 0.88 };
  if (P && !I && !M && !A && Mi) return { letra: 'Y', confianca: 0.88 };
  if (!P && I && !M && !A && !Mi) return { letra: 'D', confianca: 0.82 };
  if (!P && !I && !M && !A && Mi) return { letra: 'I', confianca: 0.85 };
  if (!P && I && M && A && !Mi) return { letra: 'W', confianca: 0.82 };
  if (P && I && M && !A && !Mi) return { letra: 'K', confianca: 0.75 };

  if (!P && I && M && !A && !Mi) {
    if (distIMN > 0.20) return { letra: 'V', confianca: 0.82 }; 
    else return { letra: 'U', confianca: 0.80 }; 
  }

  if (!P && I && M && !A && !Mi && distIMN < 0.14) return { letra: 'R', confianca: 0.72 };
  if (!P && !I && !M && !A && !Mi && distNorm < 0.20) return { letra: 'O', confianca: 0.78 };
  if (!I && M && A && Mi && distNorm < 0.22) return { letra: 'F', confianca: 0.76 };
  if (!P && !I && !M && !A && !Mi && indCurv > 0 && indCurv < 0.08) return { letra: 'C', confianca: 0.62 };
  if (!P && !I && !M && !A && !Mi && indCurv > 0.05) return { letra: 'E', confianca: 0.60 };

  return null; 
}

function dist2D(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function atualizarResultadoCamera(letra, confianca) {
  var elLetra = document.getElementById('letra-camera-detectada');
  if (elLetra) elLetra.textContent = letra || '—';

  var elConf = document.getElementById('lbl-confianca');
  if (elConf) elConf.textContent = letra ? (Math.round(confianca * 100) + '%') : '';

  var fill = document.getElementById('conf-fill');
  if (fill) fill.style.width = (letra ? Math.round(confianca * 100) : 0) + '%';
}

function iniciarModoDemo() {
  var video     = document.getElementById('cameraVideo');
  var camCanvas = document.getElementById('cameraCanvas');
  var camCtx    = camCanvas.getContext('2d');
  var frame     = 0;
  var letrasDemo = 'ABCDEFILMOSVY'.split('');

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
      camCtx.fillStyle = 'rgba(0,212,255,0.65)';
      camCtx.fill();
    }

    if (frame % 90 === 0) {
      var l    = letrasDemo[Math.floor(Math.random() * letrasDemo.length)];
      var conf = 0.60 + Math.random() * 0.35;
      atualizarResultadoCamera(l, conf);
      falar(l);
      var textoEl = document.getElementById('texto-detectado');
      if (textoEl) textoEl.textContent += l;
    }
  }
  loop();
  log('ℹ Modo demonstração ativo', 'info');
}

// ============================================================
// SEÇÃO 8 — WEB SPEECH API
// ============================================================

function falar(texto) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  var utt    = new SpeechSynthesisUtterance(texto);
  utt.lang   = 'pt-BR';
  utt.rate   = 0.90;
  utt.pitch  = 1.0;
  utt.volume = 1.0;

  var vozes  = window.speechSynthesis.getVoices();
  var vozPT  = null;
  for (var i = 0; i < vozes.length; i++) {
    if (vozes[i].lang && vozes[i].lang.startsWith('pt')) {
      vozPT = vozes[i];
      break;
    }
  }
  if (vozPT) utt.voice = vozPT;

  window.speechSynthesis.speak(utt);
}

// ============================================================
// SEÇÃO 9 — BLUETOOTH
// ============================================================

async function conectarBluetooth() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth não suportado.\nUse Chrome no Android ou Chrome Desktop.');
    log('✗ Web Bluetooth indisponível neste browser', 'error');
    return;
  }
  if (btConectando) return;

  btConectando = true;
  atualizarBTUI('connecting', 'Conectando...');
  log('🔍 Procurando LibraTronic...', 'info');

  try {
    btDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'LibraTronic' },
        { services: [BT_UUID_SERVICO] },
      ],
      optionalServices: [BT_UUID_SERVICO],
    });

    log('✓ Dispositivo: ' + btDevice.name, 'success');
    var servidor = await btDevice.gatt.connect();
    var servico  = await servidor.getPrimaryService(BT_UUID_SERVICO);
    btCarac      = await servico.getCharacteristic(BT_UUID_CARAC);

    btConectado  = true;
    btConectando = false;
    atualizarBTUI('connected', btDevice.name);
    log('✓ Bluetooth conectado!', 'success');

    btDevice.addEventListener('gattserverdisconnected', function() {
      btConectado = false;
      btCarac     = null;
      atualizarBTUI('disconnected', 'Desconectado');
      log('✗ Bluetooth desconectado!', 'error');
    });

  } catch (e) {
    btConectando = false;
    atualizarBTUI('disconnected', 'Falha');
    if (e.message && e.message.includes('User cancelled')) {
      log('⚠ Conexão cancelada pelo usuário', 'info');
    } else {
      log('✗ Erro BT: ' + (e.message || e), 'error');
    }
  }
}

function desconectarBluetooth() {
  if (btDevice && btDevice.gatt && btDevice.gatt.connected) {
    btDevice.gatt.disconnect();
  }
  btConectado = false;
  btCarac     = null;
  atualizarBTUI('disconnected', 'Desconectado');
  log('✓ Bluetooth desconectado', 'info');
}

async function enviarBT(comando) {
  if (!btCarac || !btConectado) return;
  try {
    var bytes = new TextEncoder().encode('<' + comando + '>');
    await btCarac.writeValue(bytes);
  } catch (e) {
    log('✗ Falha envio BT: ' + (e.message || e), 'error');
    btConectado = false;
    atualizarBTUI('disconnected', 'Erro');
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
// SEÇÃO 10 — FEEDBACK VISUAL
// ============================================================

function renderizarChips(letras) {
  var c = document.getElementById('fila-chips');
  if (!c) return;
  c.innerHTML = '';
  for (var i = 0; i < letras.length; i++) {
    var d = document.createElement('div');
    d.className   = 'chip';
    d.textContent = letras[i];
    d.id          = 'chip-' + i;
    c.appendChild(d);
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
  el.textContent  = texto;
  el.style.fontSize = '2.8rem';
}

function setLetraAtualGrande(texto) {
  var el = document.getElementById('letra-atual');
  if (!el) return;
  el.textContent    = texto;
  el.style.fontSize = texto.length > 6 ? '1.2rem' : '1.8rem';
}

function setFeedbackModo(texto) {
  var el = document.getElementById('feedback-modo');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(function() { el.textContent = texto; el.style.opacity = '1'; }, 60);
}

function log(msg, tipo) {
  var box = document.getElementById('log-box');
  if (!box) return;
  var d   = document.createElement('div');
  d.className   = 'log-line ' + (tipo || 'info');
  var h   = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  d.textContent = '[' + h + '] ' + msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 60) box.removeChild(box.firstChild);
}

function esperar(ms) {
  return new Promise(function(res) { setTimeout(res, ms); });
}

// ============================================================
// SEÇÃO 12 — BANCO FALLBACK EMBUTIDO
// Usado quando fetch('./database.json') falha
// ============================================================
function getBancoFallback() {
  var R = {
    A:  { c:'CMD_A',  r:{polegar:{x:0.00,y:0,z:-0.20},indicador:{x:1.55,y:0,z:0.04},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.04},mindinho:{x:1.55,y:0,z:-0.09}}},
    B:  { c:'CMD_B',  r:{polegar:{x:0.90,y:0,z:0.35}, indicador:{x:0.00,y:0,z:0.05},medio:{x:0.00,y:0,z:0.00},anelar:{x:0.00,y:0,z:-0.05},mindinho:{x:0.00,y:0,z:-0.10}}},
    C:  { c:'CMD_C',  r:{polegar:{x:0.00,y:0,z:-0.90},indicador:{x:0.75,y:0,z:0.06},medio:{x:0.75,y:0,z:0.00},anelar:{x:0.75,y:0,z:-0.06},mindinho:{x:0.70,y:0,z:-0.12}}},
    D:  { c:'CMD_D',  r:{polegar:{x:0.00,y:0,z:-0.55},indicador:{x:0.00,y:0,z:0.00},medio:{x:1.40,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    E:  { c:'CMD_E',  r:{polegar:{x:0.60,y:0,z:-0.10},indicador:{x:1.35,y:0,z:0.05},medio:{x:1.35,y:0,z:0.00},anelar:{x:1.35,y:0,z:-0.05},mindinho:{x:1.30,y:0,z:-0.10}}},
    F:  { c:'CMD_F',  r:{polegar:{x:0.00,y:0,z:-0.55},indicador:{x:1.10,y:0,z:0.15},medio:{x:0.00,y:0,z:0.00},anelar:{x:0.00,y:0,z:-0.05},mindinho:{x:0.00,y:0,z:-0.12}}},
    G:  { c:'CMD_G',  r:{polegar:{x:0.00,y:-1.40,z:-1.10},indicador:{x:0.00,y:-1.57,z:0.00},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00},mindinho:{x:1.55,y:0,z:0.00}}},
    H:  { c:'CMD_H',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:-1.57,z:0.09},medio:{x:0.00,y:-1.57,z:-0.09},anelar:{x:1.55,y:0,z:0.00},mindinho:{x:1.55,y:0,z:0.00}}},
    I:  { c:'CMD_I',  r:{polegar:{x:0.30,y:0,z:-0.20},indicador:{x:1.55,y:0,z:0.04},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.04},mindinho:{x:0.00,y:0,z:0.00}}},
    J:  { c:'CMD_J',  r:{polegar:{x:0.30,y:0,z:-0.20},indicador:{x:1.55,y:0,z:0.04},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.04},mindinho:{x:0.00,y:0,z:0.00}}},
    K:  { c:'CMD_K',  r:{polegar:{x:0.00,y:0,z:-0.50},indicador:{x:0.00,y:0,z:0.00},medio:{x:0.00,y:0,z:-0.45},anelar:{x:1.55,y:0,z:0.00},mindinho:{x:1.55,y:0,z:0.00}}},
    L:  { c:'CMD_L',  r:{polegar:{x:0.00,y:0,z:-1.57},indicador:{x:0.00,y:0,z:0.00},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    M:  { c:'CMD_M',  r:{polegar:{x:0.50,y:0,z:-0.10},indicador:{x:1.05,y:0,z:0.05},medio:{x:1.05,y:0,z:0.00},anelar:{x:1.05,y:0,z:-0.05},mindinho:{x:1.55,y:0,z:-0.10}}},
    N:  { c:'CMD_N',  r:{polegar:{x:0.50,y:0,z:-0.10},indicador:{x:1.05,y:0,z:0.05},medio:{x:1.05,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.05},mindinho:{x:1.55,y:0,z:-0.10}}},
    O:  { c:'CMD_O',  r:{polegar:{x:0.00,y:0,z:-1.05},indicador:{x:0.90,y:0,z:0.06},medio:{x:0.95,y:0,z:0.00},anelar:{x:0.90,y:0,z:-0.06},mindinho:{x:0.85,y:0,z:-0.12}}},
    P:  { c:'CMD_P',  r:{polegar:{x:0.00,y:0,z:-0.60},indicador:{x:0.00,y:0,z:0.50},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    Q:  { c:'CMD_Q',  r:{polegar:{x:0.00,y:0,z:0.55}, indicador:{x:0.00,y:0.50,z:0.55},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00},mindinho:{x:1.55,y:0,z:0.00}}},
    R:  { c:'CMD_R',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:0,z:0.22},medio:{x:0.00,y:0,z:-0.22},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    S:  { c:'CMD_S',  r:{polegar:{x:0.00,y:0,z:-0.05},indicador:{x:1.55,y:0,z:0.04},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.04},mindinho:{x:1.55,y:0,z:-0.09}}},
    T:  { c:'CMD_T',  r:{polegar:{x:0.00,y:0,z:-0.35},indicador:{x:0.85,y:0,z:0.00},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    U:  { c:'CMD_U',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:0,z:0.07},medio:{x:0.00,y:0,z:-0.07},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    V:  { c:'CMD_V',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:0,z:0.28},medio:{x:0.00,y:0,z:-0.28},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    W:  { c:'CMD_W',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:0,z:0.32},medio:{x:0.00,y:0,z:0.00}, anelar:{x:0.00,y:0,z:-0.32},mindinho:{x:1.55,y:0,z:0.00}}},
    X:  { c:'CMD_X',  r:{polegar:{x:0.00,y:0,z:-0.45},indicador:{x:0.90,y:0,z:0.00},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
    Y:  { c:'CMD_Y',  r:{polegar:{x:0.00,y:0,z:-1.57},indicador:{x:1.55,y:0,z:0.04},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:-0.04},mindinho:{x:0.00,y:0,z:0.00}}},
    Z:  { c:'CMD_Z',  r:{polegar:{x:1.30,y:0,z:0.00}, indicador:{x:0.00,y:0,z:0.00},medio:{x:1.55,y:0,z:0.00},anelar:{x:1.55,y:0,z:0.00}, mindinho:{x:1.55,y:0,z:0.00}}},
  };

  var letras = {};
  Object.keys(R).forEach(function(k) {
    letras[k] = { comando: R[k].c, rotacoes3d: R[k].r };
  });

  return {
    letras: letras,
    palavras: {
      AJUDA:    { duas_maos:true,  comando:'CMD_AJUDA',    descricao:'Punho A sobre mão B aberta',  mao_direita:{rotacoes3d: R.A.r}, mao_esquerda:{rotacoes3d: R.B.r} },
      OBRIGADO: { duas_maos:false, comando:'CMD_OBRIGADO', descricao:'Mão B do queixo para frente', mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:null },
      AGUA:     { duas_maos:false, comando:'CMD_AGUA',     descricao:'Mão W tocando lábios',        mao_direita:{rotacoes3d: R.W.r}, mao_esquerda:null },
      BANHEIRO: { duas_maos:false, comando:'CMD_BANHEIRO', descricao:'Mão U com rotação de pulso',  mao_direita:{rotacoes3d: R.U.r}, mao_esquerda:null },
      SOCORRO:  { duas_maos:true,  comando:'CMD_SOCORRO',  descricao:'Ambas as mãos em S',          mao_direita:{rotacoes3d: R.S.r}, mao_esquerda:{rotacoes3d: R.S.r} },
      COMIDA:   { duas_maos:false, comando:'CMD_COMIDA',   descricao:'Mão O levando à boca',        mao_direita:{rotacoes3d: R.O.r}, mao_esquerda:null },
      PERIGO:   { duas_maos:true,  comando:'CMD_PERIGO',   descricao:'Ambas as mãos em Y tremendo', mao_direita:{rotacoes3d: R.Y.r}, mao_esquerda:{rotacoes3d: R.Y.r} },
      'POR FAVOR':{ duas_maos:false,comando:'CMD_PORFAVOR',descricao:'Mão B circular no peito',     mao_direita:{rotacoes3d: R.B.r}, mao_esquerda:null },
      SIM:      { duas_maos:false, comando:'CMD_SIM',      descricao:'Punho S acenando',            mao_direita:{rotacoes3d: R.S.r}, mao_esquerda:null },
      NAO:      { duas_maos:false, comando:'CMD_NAO',      descricao:'Indicador abanando',          mao_direita:{rotacoes3d: R.D.r}, mao_esquerda:null },
    },
    configuracoes: { intervaloBetweenLetras:900, tempoTransicao3d:700, debounceCamera:2000 }
  };
}