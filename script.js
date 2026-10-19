// ============================================================
// script.js — LibraTronic v4.0 (ES6+ Clean Architecture)
// Tradução Libras Oficial · Mão Biônica 3D · Visão Computacional IA
// Destaques v4.0:
//  - Arquitetura Modular ES6+: Controladores desacoplados para
//    Áudio/Fala, Bluetooth BLE (com fila GATT e auto-reconexão),
//    Filtro EMA + Buffer Anti-Flicker de Câmera e Motor de Tradução.
//  - Reconhecimento Dinâmico na Câmera: Suavização espacial de
//    21 pontos + detecção de trajetória para diferenciar I/J e D/Z.
//  - Zero Memory Leaks: Fechamento determinístico de instâncias
//    MediaPipe Hands, MediaStreamTracks, WebGL e Page Visibility API.
// ============================================================

'use strict';

// ============================================================
// 1. CONSTANTES E CONFIGURAÇÕES GLOBAIS
// ============================================================
const PALAVRAS_CHAVE = Object.freeze([
  'POR FAVOR', 'OBRIGADO', 'BANHEIRO', 'SOCORRO',
  'COMIDA', 'PERIGO', 'AJUDA', 'AGUA', 'SIM', 'NAO'
]);

const MAPA_FONETICO = Object.freeze({
  A: 'á', B: 'bê', C: 'cê', D: 'dê', E: 'ê', F: 'éfe',
  G: 'gê', H: 'agá', I: 'i', J: 'jóta', K: 'cá', L: 'éle',
  M: 'ême', N: 'êne', O: 'ô', P: 'pê', Q: 'quê', R: 'érre',
  S: 'ésse', T: 'tê', U: 'u', V: 'vê', W: 'dáblio', X: 'xis',
  Y: 'ípsilon', Z: 'zê',
  AGUA: 'água',
  NAO: 'não',
  SIM: 'sim',
  AJUDA: 'ajuda',
  SOCORRO: 'socorro',
  OBRIGADO: 'obrigado',
  COMIDA: 'comida',
  BANHEIRO: 'banheiro',
  PERIGO: 'perigo',
  'POR FAVOR': 'por favor'
});

const BT_CONFIG = Object.freeze({
  UUID_SERVICO: '0000ffe0-0000-1000-8000-00805f9b34fb',
  UUID_CARAC:   '0000ffe1-0000-1000-8000-00805f9b34fb',
  MAX_RETRIES:  3,
  BASE_DELAY_MS: 1200,
  WRITE_TIMEOUT_MS: 2500
});

// ============================================================
// 2. ESTADO CENTRAL DA APLICAÇÃO E REGISTRO DE TIMERS
// ============================================================
const AppState = {
  bancoDados: null,
  telaAtual: 'home',
  vozAtiva: true,
  velocidadeTraducao: 1.0,
  traduzindo: false,
  abortarTraducao: false,
  debounceMs: 1650
};

class TimerRegistry {
  constructor() {
    this._timers = new Set();
  }

  schedule(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, ms);
    this._timers.add(id);
    return id;
  }

  clearAll() {
    for (const id of this._timers) {
      clearTimeout(id);
    }
    this._timers.clear();
  }

  sleep(ms) {
    return new Promise((resolve) => this.schedule(resolve, ms));
  }
}

const timers = new TimerRegistry();

// ============================================================
// 3. SERVIÇO DE SÍNTESE DE VOZ (Web Speech API)
// ============================================================
const SpeechService = {
  falar(chave) {
    if (!AppState.vozAtiva || !('speechSynthesis' in window)) return;
    const chaveUpper = String(chave || '').toUpperCase().trim();
    const textoFala = MAPA_FONETICO[chaveUpper] || chaveUpper.toLowerCase();
    this.falarTextoLivre(textoFala);
  },

  falarTextoLivre(texto) {
    if (!AppState.vozAtiva || !('speechSynthesis' in window) || !texto) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(texto);
      utt.lang = 'pt-BR';
      utt.rate = Math.min(Math.max(0.94 * AppState.velocidadeTraducao, 0.7), 1.45);
      utt.pitch = 1.0;
      utt.volume = 1.0;

      const vozes = window.speechSynthesis.getVoices();
      const vozPt = vozes.find((v) => v.lang && v.lang.toLowerCase().startsWith('pt'));
      if (vozPt) utt.voice = vozPt;

      window.speechSynthesis.speak(utt);
    } catch (_) {
      // Ignora silenciosamente se bloqueado por autoplay policy
    }
  },

  cancelar() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
};

// ============================================================
// 4. GERENCIADOR BLUETOOTH BLE (Auto-Reconexão + Fila GATT)
// ============================================================
class BluetoothManager {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.conectado = false;
    this.conectando = false;
    this.desconexaoManual = false;
    this.tentativasReconexao = 0;
    this.timerReconexao = null;
    this.filaComandos = [];
    this.escrevendoGatt = false;

    this._onDisconnectedBound = this._onDisconnected.bind(this);
  }

  async conectar() {
    if (!navigator.bluetooth) {
      mostrarNotificacaoUI('Web Bluetooth não suportado neste navegador. Use Chrome ou Edge.', 'error');
      log('✗ Web Bluetooth indisponível neste navegador', 'error');
      return;
    }
    if (this.conectando) return;

    this._limparTimerReconexao();
    this.desconexaoManual = false;
    this.conectando = true;
    this.atualizarUI('connecting', 'Conectando...');
    log('🔍 Procurando hardware ESP32 LibraTronic...', 'info');

    try {
      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this._onDisconnectedBound);
      }

      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'LibraTronic' },
          { services: [BT_CONFIG.UUID_SERVICO] }
        ],
        optionalServices: [BT_CONFIG.UUID_SERVICO]
      });

      this.device.addEventListener('gattserverdisconnected', this._onDisconnectedBound);

      log(`✓ Dispositivo localizado: ${this.device.name || 'ESP32'}`, 'success');
      await this._estabelecerSessaoGatt();
    } catch (err) {
      this.conectando = false;
      this.atualizarUI('disconnected', 'Desconectado');
      const msg = err?.message || String(err);
      if (msg.toLowerCase().includes('cancelled') || msg.toLowerCase().includes('canceled')) {
        log('ℹ Busca Bluetooth cancelada pelo usuário', 'info');
      } else {
        log(`✗ Erro BT: ${msg}`, 'error');
      }
    }
  }

  async _estabelecerSessaoGatt() {
    if (!this.device?.gatt) throw new Error('Dispositivo GATT inválido');

    const servidor = await this.device.gatt.connect();
    const servico = await servidor.getPrimaryService(BT_CONFIG.UUID_SERVICO);
    this.characteristic = await servico.getCharacteristic(BT_CONFIG.UUID_CARAC);

    this.conectado = true;
    this.conectando = false;
    this.tentativasReconexao = 0;
    this.filaComandos = [];
    this.escrevendoGatt = false;

    const nome = this.device.name || 'LibraTronic';
    this.atualizarUI('connected', nome);
    log(`✓ Bluetooth BLE conectado (${nome})`, 'success');
  }

  _onDisconnected() {
    this.conectado = false;
    this.conectando = false;
    this.characteristic = null;
    this.filaComandos = [];
    this.escrevendoGatt = false;

    if (this.desconexaoManual) {
      this.atualizarUI('disconnected', 'Desconectado');
      return;
    }

    log('⚠ Queda de sinal Bluetooth detectada', 'error');
    this._tentarReconectarAutomaticamente();
  }

  _tentarReconectarAutomaticamente() {
    if (this.desconexaoManual || !this.device) {
      this.atualizarUI('disconnected', 'Desconectado');
      return;
    }

    if (this.tentativasReconexao >= BT_CONFIG.MAX_RETRIES) {
      this.tentativasReconexao = 0;
      this.atualizarUI('disconnected', 'Desconectado');
      log('✗ Reconexão automática falhou após 3 tentativas', 'error');
      return;
    }

    this.tentativasReconexao++;
    const delay = BT_CONFIG.BASE_DELAY_MS * Math.pow(1.6, this.tentativasReconexao - 1);
    this.atualizarUI(
      'connecting',
      `Reconectando (${this.tentativasReconexao}/${BT_CONFIG.MAX_RETRIES})...`
    );
    log(`↻ Tentando reconectar ao ESP32 (${this.tentativasReconexao}/${BT_CONFIG.MAX_RETRIES})...`, 'info');

    this._limparTimerReconexao();
    this.timerReconexao = setTimeout(async () => {
      if (this.desconexaoManual || !this.device) return;
      try {
        this.conectando = true;
        await this._estabelecerSessaoGatt();
        log('✓ Reconexão automática Bluetooth concluída!', 'success');
      } catch (_) {
        this.conectando = false;
        this._tentarReconectarAutomaticamente();
      }
    }, delay);
  }

  desconectar() {
    this.desconexaoManual = true;
    this._limparTimerReconexao();

    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnectedBound);
      if (this.device.gatt?.connected) {
        try {
          this.device.gatt.disconnect();
        } catch (_) {}
      }
    }

    this.conectado = false;
    this.conectando = false;
    this.characteristic = null;
    this.filaComandos = [];
    this.escrevendoGatt = false;
    this.atualizarUI('disconnected', 'Desconectado');
    log('✓ Bluetooth desconectado com segurança', 'info');
  }

  enviar(comando) {
    if (!this.conectado || !this.characteristic || !comando) return;
    // Evita acumular comandos repetidos na fila
    if (this.filaComandos[this.filaComandos.length - 1] !== comando) {
      this.filaComandos.push(comando);
    }
    this._processarFila();
  }

  async _processarFila() {
    if (this.escrevendoGatt || !this.conectado || !this.characteristic) return;
    const proximo = this.filaComandos.shift();
    if (!proximo) return;

    this.escrevendoGatt = true;
    const payload = new TextEncoder().encode(`<${proximo}>`);

    try {
      const writePromise = this.characteristic.writeValueWithoutResponse
        ? this.characteristic.writeValueWithoutResponse(payload)
        : this.characteristic.writeValue(payload);

      await Promise.race([
        writePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de escrita GATT')), BT_CONFIG.WRITE_TIMEOUT_MS)
        )
      ]);
    } catch (err) {
      log(`✗ Falha no envio BT (${proximo}): ${err?.message || err}`, 'error');
      this._onDisconnected();
      return;
    } finally {
      this.escrevendoGatt = false;
    }

    if (this.filaComandos.length > 0) {
      this._processarFila();
    }
  }

  _limparTimerReconexao() {
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
  }

  atualizarUI(estado, texto) {
    document.querySelectorAll('.bt-dot').forEach((el) => {
      el.className =
        'bt-dot' +
        (estado === 'connected' ? ' connected' : '') +
        (estado === 'connecting' ? ' connecting' : '');
    });
    document.querySelectorAll('.bt-status-text').forEach((el) => {
      el.textContent = texto;
    });
    const nomeEl = document.getElementById('bt-device-name');
    if (nomeEl) nomeEl.textContent = texto;
  }
}

const btManager = new BluetoothManager();

// ============================================================
// 5. VISÃO COMPUTACIONAL: FILTRO EMA + BUFFER ANTI-FLICKER + TRAJETÓRIA
// ============================================================

/**
 * Suaviza coordenadas 2D/3D dos 21 landmarks via Exponential Moving Average (EMA)
 * para eliminar micro-tremores da webcam antes da classificação geométrica.
 */
class LandmarkSmoother {
  constructor(alpha = 0.58) {
    this.alpha = alpha;
    this.prev = null;
  }

  smooth(landmarks) {
    if (!landmarks || landmarks.length < 21) {
      this.prev = null;
      return landmarks;
    }
    if (!this.prev) {
      this.prev = landmarks.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z || 0 }));
      return this.prev;
    }
    const a = this.alpha;
    for (let i = 0; i < landmarks.length; i++) {
      this.prev[i].x = this.prev[i].x + a * (landmarks[i].x - this.prev[i].x);
      this.prev[i].y = this.prev[i].y + a * (landmarks[i].y - this.prev[i].y);
      this.prev[i].z = this.prev[i].z + a * ((landmarks[i].z || 0) - this.prev[i].z);
    }
    return this.prev;
  }

  reset() {
    this.prev = null;
  }
}

/**
 * Buffer de estabilidade temporal com janela de votação + histerese anti-flicker.
 * Evita que 1 ou 2 frames ruidosos zerem o progresso da letra que o usuário está segurando.
 */
class GestureStabilityBuffer {
  constructor(framesNecessarios = 11) {
    this.framesNecessarios = framesNecessarios;
    this.historico = [];
    this.maxHistorico = 7;
    this.letraCandidata = '';
    this.contadorEstabilidade = 0;
    this.ultimaLetraConfirmada = '';
    this.tsUltimaConfirmacao = 0;

    // Histórico espacial curto para detectar letras dinâmicas (J e Z)
    this.trilhaIndicador = [];
    this.trilhaMindinho = [];
    this.maxTrilha = 16;
  }

  reset() {
    this.historico = [];
    this.letraCandidata = '';
    this.contadorEstabilidade = 0;
    this.trilhaIndicador = [];
    this.trilhaMindinho = [];
  }

  registrarPontosTrajetoria(lm) {
    if (!lm || lm.length < 21) return;
    const tamMao = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.1;

    this.trilhaIndicador.push({ x: lm[8].x, y: lm[8].y, scale: tamMao });
    if (this.trilhaIndicador.length > this.maxTrilha) this.trilhaIndicador.shift();

    this.trilhaMindinho.push({ x: lm[20].x, y: lm[20].y, scale: tamMao });
    if (this.trilhaMindinho.length > this.maxTrilha) this.trilhaMindinho.shift();
  }

  detectarMovimentoDinamico(letraEstatica) {
    // Se a mão está em I e o mindinho traçou movimento descendente + lateral -> J
    if (letraEstatica === 'I' && this.trilhaMindinho.length >= 10) {
      const ini = this.trilhaMindinho[0];
      const fim = this.trilhaMindinho[this.trilhaMindinho.length - 1];
      const dy = (fim.y - ini.y) / fim.scale;
      const dx = Math.abs(fim.x - ini.x) / fim.scale;
      if (dy > 0.36 && dx > 0.16) {
        return 'J';
      }
    }

    // Se a mão está com indicador estendido (D ou G) e houve varredura ampla em X e Y -> Z
    if ((letraEstatica === 'D' || letraEstatica === 'G') && this.trilhaIndicador.length >= 12) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const scale = this.trilhaIndicador[this.trilhaIndicador.length - 1].scale;
      for (const pt of this.trilhaIndicador) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      const ampX = (maxX - minX) / scale;
      const ampY = (maxY - minY) / scale;
      if (ampX > 0.55 && ampY > 0.32) {
        return 'Z';
      }
    }

    return letraEstatica;
  }

  processarPredicao(predicaoBruta) {
    if (!predicaoBruta || predicaoBruta.confianca < 0.70) {
      // Decaimento suave (histerese): não zera imediatamente em 1 frame perdido
      this.contadorEstabilidade = Math.max(0, this.contadorEstabilidade - 1.5);
      if (this.contadorEstabilidade === 0) {
        this.letraCandidata = '';
        this.historico = [];
      }
      return {
        letra: this.letraCandidata,
        confianca: predicaoBruta ? predicaoBruta.confianca : 0,
        estabilidadePct: Math.round((this.contadorEstabilidade / this.framesNecessarios) * 100),
        confirmada: false
      };
    }

    const letraRefinada = this.detectarMovimentoDinamico(predicaoBruta.letra);

    // Janela de votação majoritária (Moving Window Majority Vote)
    this.historico.push(letraRefinada);
    if (this.historico.length > this.maxHistorico) {
      this.historico.shift();
    }

    const contagem = {};
    let letraDominante = letraRefinada;
    let maiorVoto = 0;
    for (const l of this.historico) {
      contagem[l] = (contagem[l] || 0) + 1;
      if (contagem[l] > maiorVoto) {
        maiorVoto = contagem[l];
        letraDominante = l;
      }
    }

    if (letraDominante === this.letraCandidata) {
      this.contadorEstabilidade = Math.min(
        this.framesNecessarios,
        this.contadorEstabilidade + 1
      );
    } else {
      // Histerese na troca de candidata
      this.contadorEstabilidade = Math.max(0, this.contadorEstabilidade - 2);
      if (this.contadorEstabilidade <= 1) {
        this.letraCandidata = letraDominante;
        this.contadorEstabilidade = 1;
      }
    }

    const estabilidadePct = Math.min(
      100,
      Math.round((this.contadorEstabilidade / this.framesNecessarios) * 100)
    );

    let confirmada = false;
    let novaLetra = false;

    if (this.contadorEstabilidade >= this.framesNecessarios) {
      const agora = Date.now();
      novaLetra = this.letraCandidata !== this.ultimaLetraConfirmada;
      const tempoDebounceOk = agora - this.tsUltimaConfirmacao >= AppState.debounceMs;

      if (novaLetra || tempoDebounceOk) {
        this.ultimaLetraConfirmada = this.letraCandidata;
        this.tsUltimaConfirmacao = agora;
        confirmada = true;
      }
    }

    return {
      letra: this.letraCandidata,
      confianca: predicaoBruta.confianca,
      estabilidadePct,
      confirmada,
      novaLetra
    };
  }
}

// ============================================================
// 6. CLASSIFICADOR GEOMÉTRICO DE LIBRAS (21 Landmarks)
// ============================================================
function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function reconhecerConfiguracao(lm) {
  const tamMao = dist2D(lm[0], lm[9]);
  if (tamMao < 0.02) return null;

  // Estado de extensão vertical dos 4 dedos (Indicador, Médio, Anelar, Mindinho)
  const I  = lm[8].y  < lm[6].y  - tamMao * 0.11 && lm[6].y  < lm[5].y;
  const M  = lm[12].y < lm[10].y - tamMao * 0.11 && lm[10].y < lm[9].y;
  const A  = lm[16].y < lm[14].y - tamMao * 0.11 && lm[14].y < lm[13].y;
  const Mi = lm[20].y < lm[18].y - tamMao * 0.09 && lm[18].y < lm[17].y;

  // Abertura lateral do polegar (invariante a mão direita/esquerda e espelhamento)
  const distPolMind   = dist2D(lm[4], lm[17]) / tamMao;
  const distBaseMind  = dist2D(lm[2], lm[17]) / tamMao;
  const distPolIndMCP = dist2D(lm[4], lm[5])  / tamMao;
  const P = distPolMind > distBaseMind * 1.21 && distPolIndMCP > 0.42;

  // Distâncias normalizadas entre pontos-chave
  const distPI  = dist2D(lm[4], lm[8])  / tamMao;
  const distPM  = dist2D(lm[4], lm[12]) / tamMao;
  const distIM  = dist2D(lm[8], lm[12]) / tamMao;
  const distPIP = dist2D(lm[6], lm[10]) / tamMao;

  // 1. Quatro dedos estendidos (B)
  if (I && M && A && Mi) {
    return { letra: 'B', confianca: 0.93 };
  }

  // 2. Indicador flexionado e Médio + Anelar + Mindinho estendidos (F vs T)
  if (!I && M && A && Mi) {
    if (distPI < 0.42) return { letra: 'F', confianca: 0.88 };
    return { letra: 'T', confianca: 0.84 };
  }

  // 3. Indicador + Médio + Anelar estendidos, Mindinho recolhido (W)
  if (I && M && A && !Mi) {
    return { letra: 'W', confianca: 0.90 };
  }

  // 4. Indicador + Médio estendidos, Anelar + Mindinho recolhidos (R, K, V, U)
  if (I && M && !A && !Mi) {
    const dirBaseX  = lm[5].x - lm[9].x;
    const dirPontaX = lm[8].x - lm[12].x;
    const cruzados  = dirBaseX * dirPontaX < 0 || distIM < distPIP * 0.72;
    if (cruzados) return { letra: 'R', confianca: 0.87 };
    if (P)        return { letra: 'K', confianca: 0.85 };
    if (distIM > 0.24) return { letra: 'V', confianca: 0.91 };
    return { letra: 'U', confianca: 0.89 };
  }

  // 5. Apenas Indicador estendido (L, D, G)
  if (I && !M && !A && !Mi) {
    if (P)             return { letra: 'L', confianca: 0.93 };
    if (distPM < 0.43) return { letra: 'D', confianca: 0.87 };
    return { letra: 'G', confianca: 0.84 };
  }

  // 6. Apenas Mindinho estendido (Y vs I)
  if (!I && !M && !A && Mi) {
    if (P) return { letra: 'Y', confianca: 0.92 };
    return { letra: 'I', confianca: 0.90 };
  }

  // 7. Todos os 4 dedos flexionados/curvados (O, A, S, C, E, M, N)
  if (!I && !M && !A && !Mi) {
    if (distPI < 0.30 && distPM < 0.36) {
      return { letra: 'O', confianca: 0.87 };
    }

    const punhoFechado =
      lm[8].y > lm[6].y && lm[12].y > lm[10].y && lm[16].y > lm[14].y;

    if (punhoFechado) {
      const distPolMedioPIP = dist2D(lm[4], lm[10]) / tamMao;
      if (distPolMedioPIP < 0.36) {
        return { letra: 'S', confianca: 0.86 };
      }
      return { letra: 'A', confianca: 0.90 };
    }

    if (distPI >= 0.30 && distPI <= 0.66 && P) {
      return { letra: 'C', confianca: 0.82 };
    }
    return { letra: 'E', confianca: 0.80 };
  }

  return null;
}

// ============================================================
// 7. GERENCIADOR DE CÂMERA E MEDIAPIPE HANDS (Zero Memory Leaks)
// ============================================================
let cameraStream = null;
let cameraAtiva = false;
let cameraEspelhada = true;
let camRafId = null;
let mpHands = null;
let mpCamera = null;
let processandoFrame = false;

const smoother = new LandmarkSmoother(0.58);
const stabilityBuffer = new GestureStabilityBuffer(11);

function toggleCamera() {
  if (cameraAtiva) pararCamera();
  else ligarCamera();
}

async function ligarCamera() {
  const btn = document.getElementById('btn-toggle-camera');
  if (btn) {
    btn.textContent = '⏳ Aguardando permissão...';
    btn.disabled = true;
  }

  const errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  const ehMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const constraints = ehMobile
    ? [
        { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        { facingMode: 'environment' }
      ]
    : [{ facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }];

  let stream = null;
  let ultimoErro = null;

  for (const preset of constraints) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: preset });
      break;
    } catch (err) {
      ultimoErro = err;
    }
  }

  // Se o usuário saiu da tela enquanto o popup de permissão estava aberto
  if (AppState.telaAtual !== 'camera') {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    return;
  }

  if (!stream) {
    if (btn) {
      btn.textContent = '📷 Ligar Câmera';
      btn.disabled = false;
    }
    const msg = traduzirErroCameraApi(ultimoErro);
    log(`✗ ${msg}`, 'error');
    mostrarErroCameraUI(msg);
    return;
  }

  cameraStream = stream;
  const video = document.getElementById('cameraVideo');
  video.srcObject = cameraStream;
  await video.play();

  cameraAtiva = true;
  smoother.reset();
  stabilityBuffer.reset();

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
      return `Erro de câmera: ${e.message || e.name}`;
  }
}

function mostrarErroCameraUI(msg) {
  const el = document.getElementById('camera-erro');
  if (el) {
    el.textContent = `⚠ ${msg}`;
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
    try {
      mpCamera.stop();
    } catch (_) {}
    mpCamera = null;
  }

  if (mpHands) {
    const inst = mpHands;
    mpHands = null;
    try {
      inst.close();
    } catch (_) {}
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (_) {}
    });
    cameraStream = null;
  }

  const video = document.getElementById('cameraVideo');
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  smoother.reset();
  stabilityBuffer.reset();

  const camCanvas = document.getElementById('cameraCanvas');
  if (camCanvas) {
    const ctx = camCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, camCanvas.width, camCanvas.height);
  }

  const stab = document.getElementById('stab-fill');
  if (stab) stab.style.width = '0%';

  const errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  const btn = document.getElementById('btn-toggle-camera');
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
  const video = document.getElementById('cameraVideo');
  const camCanvas = document.getElementById('cameraCanvas');
  const camCtx = camCanvas.getContext('2d');

  mpHands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  mpHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.70,
    minTrackingConfidence: 0.62
  });

  mpHands.onResults((res) => {
    if (!cameraAtiva) return;
    if (camCanvas.width !== video.videoWidth) camCanvas.width = video.videoWidth || 640;
    if (camCanvas.height !== video.videoHeight) camCanvas.height = video.videoHeight || 480;

    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
      const lmSuavizado = smoother.smooth(res.multiHandLandmarks[0]);
      desenharLandmarks(camCtx, lmSuavizado, camCanvas.width, camCanvas.height);
      processarLandmarks(lmSuavizado);
    } else {
      smoother.reset();
      const status = stabilityBuffer.processarPredicao(null);
      atualizarResultadoCamera(status.letra, status.confianca, status.estabilidadePct);
    }
  });

  mpCamera = new Camera(video, {
    onFrame: async () => {
      // Pausa inferência se aba estiver oculta (Page Visibility API)
      if (!mpHands || !cameraAtiva || processandoFrame || document.hidden) return;
      processandoFrame = true;
      try {
        await mpHands.send({ image: video });
      } catch (_) {}
      processandoFrame = false;
    },
    width: 640,
    height: 480
  });

  mpCamera.start();
  log('✓ MediaPipe Hands v4.0 ativo — estabilizador temporal ligado', 'success');
}

function desenharLandmarks(ctx, lm, w, h) {
  const CONEXOES = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17], [0, 17]
  ];

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 238, 255, 0.88)';
  ctx.lineWidth = 2.6;
  ctx.shadowColor = 'rgba(0, 212, 255, 0.55)';
  ctx.shadowBlur = 6;

  for (const [aIdx, bIdx] of CONEXOES) {
    const a = lm[aIdx];
    const b = lm[bIdx];
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  lm.forEach((pt, idx) => {
    const isPonta = idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20;
    const isPalma = idx === 0;
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, isPalma ? 7 : isPonta ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isPonta ? '#00ffea' : isPalma ? '#ffffff' : '#00d4ff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 10, 20, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  ctx.restore();
}

function processarLandmarks(lm) {
  stabilityBuffer.registrarPontosTrajetoria(lm);
  const predicaoBruta = reconhecerConfiguracao(lm);
  const status = stabilityBuffer.processarPredicao(predicaoBruta);

  atualizarResultadoCamera(status.letra, status.confianca, status.estabilidadePct);

  if (status.confirmada && status.letra) {
    const letra = status.letra;
    SpeechService.falar(letra);

    const dadosL = buscarLetra(letra);
    if (dadosL?.comando) {
      btManager.enviar(dadosL.comando);
    }

    if (status.novaLetra) {
      const textoEl = document.getElementById('texto-detectado');
      if (textoEl) textoEl.textContent += letra;
    }
  }
}

function atualizarResultadoCamera(letra, confianca, estabilidadePct) {
  const elLetra = document.getElementById('letra-camera-detectada');
  if (elLetra) elLetra.textContent = letra || '—';

  const pctConf = letra ? Math.round(confianca * 100) : 0;
  const elConf = document.getElementById('lbl-confianca');
  if (elConf) {
    elConf.textContent = letra
      ? `Confiança: ${pctConf}% · Estabilidade: ${estabilidadePct || 0}%`
      : 'Aguardando gesto...';
  }

  const fill = document.getElementById('conf-fill');
  if (fill) fill.style.width = `${pctConf}%`;

  const stab = document.getElementById('stab-fill');
  if (stab) stab.style.width = `${estabilidadePct || 0}%`;
}

function iniciarModoDemo() {
  const video = document.getElementById('cameraVideo');
  const camCanvas = document.getElementById('cameraCanvas');
  const camCtx = camCanvas.getContext('2d');
  let frame = 0;
  const letrasDemo = 'ABCDEFILJMRUVWY'.split('');

  const loop = () => {
    if (!cameraAtiva) return;
    camRafId = requestAnimationFrame(loop);
    if (document.hidden) return;
    frame++;

    camCanvas.width = video.videoWidth || 640;
    camCanvas.height = video.videoHeight || 480;
    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    const cx = camCanvas.width * 0.5;
    const cy = camCanvas.height * 0.5;
    for (let i = 0; i < 21; i++) {
      const px = cx + Math.cos(i * 0.87 + frame * 0.025) * 85;
      const py = cy + Math.sin(i * 0.87 + frame * 0.02) * 80;
      camCtx.beginPath();
      camCtx.arc(px, py, i === 0 ? 7 : 4, 0, Math.PI * 2);
      camCtx.fillStyle = 'rgba(0, 212, 255, 0.65)';
      camCtx.fill();
    }

    if (frame % 95 === 0) {
      const l = letrasDemo[Math.floor(Math.random() * letrasDemo.length)];
      const conf = 0.80 + Math.random() * 0.16;
      atualizarResultadoCamera(l, conf, 100);
      SpeechService.falar(l);
      const textoEl = document.getElementById('texto-detectado');
      if (textoEl) textoEl.textContent += l;
    }
  };
  loop();
}

// ============================================================
// 8. BANCO DE DADOS E TOKENIZADOR INTELIGENTE DE FRASES
// ============================================================
async function carregarBanco() {
  try {
    const resp = await fetch('./database.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    AppState.bancoDados = dados;
    if (dados.configuracoes?.debounceCamera) {
      AppState.debounceMs = dados.configuracoes.debounceCamera;
    }
    log(
      `✓ Banco Libras v${dados.versao || '4.0'} carregado — 26 letras + ${
        Object.keys(dados.palavras || {}).length
      } sinais oficiais`,
      'success'
    );
  } catch (_) {
    AppState.bancoDados = getBancoFallback();
    log('ℹ Banco Libras interno carregado (26 letras + 10 sinais)', 'info');
  }
}

function buscarLetra(l) {
  return AppState.bancoDados?.letras?.[l] || null;
}

function buscarPalavra(p) {
  return AppState.bancoDados?.palavras?.[p] || null;
}

function detectarPalavraChaveExata(texto) {
  const t = texto.trim().toUpperCase();
  return PALAVRAS_CHAVE.find((pk) => pk === t) || null;
}

function tokenizarTextoLibras(texto) {
  const limpo = texto.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!limpo) return [];

  const marcadorPF = '__POR_FAVOR__';
  const processado = limpo.replace(/\bPOR FAVOR\b/g, marcadorPF);
  const partes = processado.split(' ');
  const tokens = [];

  partes.forEach((parteBruta, i) => {
    const p = parteBruta === marcadorPF ? 'POR FAVOR' : parteBruta;
    if (!p) return;

    if (i > 0) {
      tokens.push({ tipo: 'espaco', valor: '⎵' });
    }

    if (PALAVRAS_CHAVE.includes(p) && buscarPalavra(p)) {
      tokens.push({ tipo: 'palavra', valor: p });
    } else {
      for (const ch of p) {
        if (/[A-Z]/.test(ch)) {
          tokens.push({ tipo: 'letra', valor: ch });
        }
      }
    }
  });

  return tokens;
}

// ============================================================
// 9. MOTOR 3D & TRADUÇÃO DE TEXTO / GESTOS
// ============================================================
function inicializar3D() {
  if (AppState.telaAtual !== 'text') return;
  if (typeof THREE === 'undefined') {
    log('⚠ Three.js não carregado — verifique sua conexão', 'error');
    return;
  }

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
  log('✓ Mão biônica 3D v4.0 inicializada', 'success');
}

function toggle3DRotacao() {
  if (!libraHand3D) return;
  const ativo = libraHand3D.toggleRotacao();
  const btn = document.getElementById('btn-3d-rotacionar');
  if (btn) {
    btn.textContent = ativo ? '⏸ Rotação' : '▶ Rotação';
    btn.classList.toggle('ativo', ativo);
  }
}

function resetar3DCamera() {
  if (!libraHand3D) return;
  libraHand3D.resetarCamera();
  const btn = document.getElementById('btn-3d-rotacionar');
  if (btn) {
    btn.textContent = '▶ Rotação';
    btn.classList.remove('ativo');
  }
}

function visualizarLetraUnica3D(letra) {
  const dados = buscarLetra(letra);
  if (!dados) return;

  document.querySelectorAll('.btn-letra-az').forEach((b) => {
    b.classList.toggle('active', b.textContent === letra);
  });

  setLetraAtual(letra);
  setFeedbackModo(dados.descricao || `Letra ${letra} em Libras`);

  if (libraHand3D && libraHand3D.pronto && dados.rotacoes3d) {
    libraHand3D.animarLetra(dados.rotacoes3d, dados.movimento, dados.pontaRastro);
  }

  SpeechService.falar(letra);

  if (btManager.conectado && dados.comando) {
    btManager.enviar(dados.comando);
    log(`↗ ${letra} → ${dados.comando}`, 'success');
  } else {
    log(`👁 Visualizando letra ${letra}${dados.descricao ? ` (${dados.descricao})` : ''}`, 'info');
  }
}

function atualizarBotaoTraduzir(emAndamento) {
  const b = document.getElementById('btn-traduzir');
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
  AppState.abortarTraducao = true;
  AppState.traduzindo = false;
  timers.clearAll();
  SpeechService.cancelar();
  atualizarBotaoTraduzir(false);
}

function iniciarTraducao() {
  if (AppState.traduzindo) {
    pararTraducaoAtiva();
    if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
    setFeedbackModo('Tradução interrompida pelo usuário');
    log('⏹ Tradução interrompida', 'info');
    return;
  }

  timers.clearAll();

  const inputEl = document.getElementById('input-texto');
  const texto = inputEl ? inputEl.value.trim().toUpperCase() : '';
  if (!texto) {
    log('⚠ Digite uma palavra ou frase para traduzir!', 'error');
    return;
  }

  const pkExata = detectarPalavraChaveExata(texto);
  if (pkExata) {
    traduzirGestoCompleto(pkExata);
  } else {
    traduzirSequenciaTokens(texto);
  }
}

async function traduzirSequenciaTokens(texto) {
  const tokens = tokenizarTextoLibras(texto);
  const tokensVisiveis = tokens.filter((t) => t.tipo !== 'espaco');

  if (tokensVisiveis.length === 0) {
    log('⚠ Nenhuma letra válida encontrada!', 'error');
    return;
  }

  renderizarChips(tokensVisiveis);

  AppState.traduzindo = true;
  AppState.abortarTraducao = false;
  atualizarBotaoTraduzir(true);

  log(`▶ Traduzindo: "${texto}"`, 'info');

  let chipIdx = 0;
  const fatorVel = 1 / (AppState.velocidadeTraducao || 1.0);

  for (const item of tokens) {
    if (AppState.abortarTraducao) break;

    if (item.tipo === 'espaco') {
      await tratarEspaco(fatorVel);
      continue;
    }

    marcarChip(chipIdx, 'active');

    if (item.tipo === 'palavra') {
      const dadosP = buscarPalavra(item.valor);
      if (dadosP) {
        const modo = dadosP.duas_maos ? 'Sinal com duas mãos' : 'Sinal com uma mão';
        setFeedbackModo(`${modo} — ${dadosP.descricao || item.valor}`);
        setLetraAtualGrande(item.valor);
        if (libraHand3D && libraHand3D.pronto) {
          libraHand3D.animarPalavra(dadosP);
        }
        SpeechService.falar(item.valor);
        if (btManager.conectado && dadosP.comando) {
          btManager.enviar(dadosP.comando);
          log(`↗ ${item.valor} → ${dadosP.comando}`, 'success');
        } else {
          log(`🤲 Sinal: ${item.valor}`, 'info');
        }
        await timers.sleep(Math.round(2100 * fatorVel));
      }
    } else {
      const letra = item.valor;
      const dados = buscarLetra(letra);
      const cmd = dados?.comando || null;

      setLetraAtual(letra);
      setFeedbackModo(dados?.descricao ? dados.descricao : `Soletração Libras — ${letra}`);

      if (libraHand3D && libraHand3D.pronto && dados?.rotacoes3d) {
        libraHand3D.animarLetra(dados.rotacoes3d, dados.movimento, dados.pontaRastro);
      }

      SpeechService.falar(letra);

      if (btManager.conectado && cmd) {
        btManager.enviar(cmd);
        log(`↗ ${letra} → ${cmd}`, 'success');
      } else {
        log(`◌ ${letra}${cmd ? ` → ${cmd}` : ''}`, 'info');
      }

      // Letras com trajetória espacial (J, Z) recebem tempo extra para completar o traçado
      const durBase = dados?.movimento === 'tracar_j' || dados?.movimento === 'tracar_z' ? 1150 : 480;
      await timers.sleep(Math.round(durBase * fatorVel));
    }

    if (AppState.abortarTraducao) break;
    marcarChip(chipIdx, 'sent');
    chipIdx++;
    await timers.sleep(Math.round(420 * fatorVel));
  }

  if (!AppState.abortarTraducao) {
    finalizarTraducao();
  } else {
    AppState.traduzindo = false;
    atualizarBotaoTraduzir(false);
  }
}

async function traduzirGestoCompleto(palavra) {
  const dados = buscarPalavra(palavra);
  if (!dados) {
    log(`ℹ Sinal composto de "${palavra}" não encontrado — soletrando`, 'info');
    traduzirSequenciaTokens(palavra);
    return;
  }

  renderizarChips([{ tipo: 'palavra', valor: palavra }]);
  marcarChip(0, 'active');

  AppState.traduzindo = true;
  AppState.abortarTraducao = false;
  atualizarBotaoTraduzir(true);

  const modo = dados.duas_maos ? 'Sinal com 2 mãos' : 'Sinal com 1 mão';
  setFeedbackModo(`${modo}: ${dados.descricao || palavra}`);
  setLetraAtualGrande(palavra);
  log(`🤲 ${palavra} — ${dados.descricao || ''}`, 'info');

  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D.animarPalavra(dados);
  }

  SpeechService.falar(palavra);

  if (btManager.conectado && dados.comando) {
    btManager.enviar(dados.comando);
    log(`↗ BT: ${dados.comando}`, 'success');
  }

  const fatorVel = 1 / (AppState.velocidadeTraducao || 1.0);
  await timers.sleep(Math.round(2400 * fatorVel));
  if (AppState.abortarTraducao) return;

  marcarChip(0, 'sent');
  if (libraHand3D && libraHand3D.pronto) libraHand3D.posicaoNeutra();
  setLetraAtual('✓');
  await timers.sleep(Math.round(520 * fatorVel));

  if (!AppState.abortarTraducao) finalizarTraducao();
}

async function tratarEspaco(fatorVel = 1) {
  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D._ativarUmaMao();
    libraHand3D.posicaoNeutra();
  }
  setLetraAtual('⎵');
  setFeedbackModo('Espaço entre palavras');
  log('⎵ Espaço entre palavras', 'info');
  if (btManager.conectado) btManager.enviar('CMD_ESPACO');
  await timers.sleep(Math.round(620 * fatorVel));
  if (!AppState.abortarTraducao) setLetraAtual('');
}

function finalizarTraducao() {
  AppState.traduzindo = false;
  AppState.abortarTraducao = false;
  atualizarBotaoTraduzir(false);

  log('✓ Tradução concluída!', 'success');
  setFeedbackModo('Tradução concluída · Clique em um chip para rever');

  timers.schedule(() => {
    if (!AppState.traduzindo && libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      setLetraAtual('');
    }
  }, 1200);

  if (btManager.conectado) {
    timers.schedule(() => {
      if (!AppState.traduzindo) btManager.enviar('CMD_REPOUSO');
    }, 900);
  }
}

function limparCampo() {
  pararTraducaoAtiva();
  const inputEl = document.getElementById('input-texto');
  if (inputEl) inputEl.value = '';
  const filaEl = document.getElementById('fila-chips');
  if (filaEl) filaEl.innerHTML = '';
  document.querySelectorAll('.btn-letra-az').forEach((b) => b.classList.remove('active'));
  setLetraAtual('');
  setFeedbackModo('Aguardando entrada...');
  log('✓ Campo limpo', 'info');
  if (libraHand3D && libraHand3D.pronto) {
    libraHand3D._ativarUmaMao();
    libraHand3D.posicaoNeutra();
  }
}

// ============================================================
// 10. UI/UX, NAVEGAÇÃO E FEEDBACK VISUAL
// ============================================================
function mostrarTela(id) {
  pararTraducaoAtiva();
  AppState.telaAtual = id;

  document.querySelectorAll('.screen').forEach((t) => t.classList.remove('active'));

  const tela = document.getElementById(`screen-${id}`);
  if (tela) tela.classList.add('active');

  if (id === 'text') {
    timers.schedule(inicializar3D, 100);
  }
}

function popularTecladoAZ() {
  const container = document.getElementById('alfabeto-rapido');
  if (!container) return;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();
  for (const letra of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-letra-az';
    btn.textContent = letra;
    btn.title = `Visualizar letra ${letra} na mão 3D`;
    btn.setAttribute('aria-label', `Letra ${letra}`);
    btn.addEventListener('click', () => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      visualizarLetraUnica3D(letra);
    });
    fragment.appendChild(btn);
  }
  container.appendChild(fragment);
}

function renderizarChips(itens) {
  const c = document.getElementById('fila-chips');
  if (!c) return;
  c.innerHTML = '';

  const fragment = document.createDocumentFragment();
  itens.forEach((item, idx) => {
    const valor = typeof item === 'string' ? item : item.valor;
    const tipo = typeof item === 'string' ? 'letra' : item.tipo;

    const d = document.createElement('div');
    d.className = 'chip clickable';
    d.textContent = valor;
    d.id = `chip-${idx}`;
    d.title = `Clique para visualizar "${valor}" na mão 3D`;

    d.addEventListener('click', () => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      document.querySelectorAll('#fila-chips .chip').forEach((ch) => ch.classList.remove('active'));
      d.classList.add('active');
      if (tipo === 'palavra') {
        const dp = buscarPalavra(valor);
        if (dp && libraHand3D && libraHand3D.pronto) {
          setLetraAtualGrande(valor);
          setFeedbackModo(dp.descricao || valor);
          libraHand3D.animarPalavra(dp);
          SpeechService.falar(valor);
        }
      } else {
        visualizarLetraUnica3D(valor);
      }
    });

    fragment.appendChild(d);
  });

  c.appendChild(fragment);
}

function marcarChip(idx, estado) {
  const el = document.getElementById(`chip-${idx}`);
  if (!el) return;
  el.classList.remove('active', 'sent');
  if (estado) el.classList.add(estado);
}

function setLetraAtual(texto) {
  const el = document.getElementById('letra-atual');
  if (!el) return;
  el.textContent = texto;
  el.style.fontSize = '2.6rem';
}

function setLetraAtualGrande(texto) {
  const el = document.getElementById('letra-atual');
  if (!el) return;
  el.textContent = texto;
  el.style.fontSize = texto.length > 6 ? '1.35rem' : '1.85rem';
}

function setFeedbackModo(texto) {
  const el = document.getElementById('feedback-modo');
  if (el) el.textContent = texto;
}

function log(msg, tipo = 'info') {
  const box = document.getElementById('log-box');
  if (!box) return;
  const d = document.createElement('div');
  d.className = `log-line ${tipo}`;
  const h = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  d.textContent = `[${h}] ${msg}`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 50) {
    box.removeChild(box.firstChild);
  }
}

function mostrarNotificacaoUI(mensagem, tipo = 'info') {
  log(mensagem, tipo);
}

// ============================================================
// 11. INICIALIZAÇÃO DO DOM E BINDING DE EVENTOS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  carregarBanco();
  popularTecladoAZ();
  mostrarTela('home');

  // ── NAVEGAÇÃO HOME ──
  document.getElementById('btn-ir-texto')?.addEventListener('click', () => mostrarTela('text'));
  document.getElementById('btn-ir-camera')?.addEventListener('click', () => mostrarTela('camera'));
  document.getElementById('btn-ir-bluetooth')?.addEventListener('click', () => mostrarTela('bluetooth'));

  // ── BOTÕES DE VOLTAR ──
  document.querySelectorAll('.btn-back').forEach((btn) => {
    btn.addEventListener('click', () => {
      pararTraducaoAtiva();
      pararCamera();
      if (libraHand3D) {
        libraHand3D.destruir();
        libraHand3D = null;
      }
      mostrarTela('home');
    });
  });

  // ── TELA TEXTO & 3D ──
  document.getElementById('btn-traduzir')?.addEventListener('click', iniciarTraducao);
  document.getElementById('btn-limpar')?.addEventListener('click', limparCampo);

  const btnVoz = document.getElementById('btn-toggle-voz');
  if (btnVoz) {
    btnVoz.addEventListener('click', () => {
      AppState.vozAtiva = !AppState.vozAtiva;
      btnVoz.textContent = AppState.vozAtiva ? '🔊 Voz: ON' : '🔇 Voz: OFF';
      btnVoz.classList.toggle('muted', !AppState.vozAtiva);
      if (!AppState.vozAtiva) SpeechService.cancelar();
    });
  }

  const selVel = document.getElementById('select-velocidade');
  if (selVel) {
    selVel.addEventListener('change', function () {
      AppState.velocidadeTraducao = parseFloat(this.value) || 1.0;
      log(`⏱ Velocidade ajustada para ${AppState.velocidadeTraducao}x`, 'info');
    });
  }

  const inputTexto = document.getElementById('input-texto');
  if (inputTexto) {
    inputTexto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        iniciarTraducao();
      }
    });

    inputTexto.addEventListener('input', function () {
      const pos = this.selectionStart;
      const limpo = this.value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z \n]/g, '');
      if (this.value !== limpo) {
        this.value = limpo;
        try {
          this.setSelectionRange(pos, pos);
        } catch (_) {}
      }
    });
  }

  // ── CONTROLES 3D ──
  document.getElementById('btn-3d-rotacionar')?.addEventListener('click', toggle3DRotacao);
  document.getElementById('btn-3d-resetar')?.addEventListener('click', resetar3DCamera);

  document.getElementById('btn-3d-neutra')?.addEventListener('click', () => {
    if (libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      setLetraAtual('');
      setFeedbackModo('Posição neutra / repouso');
    }
  });

  // ── SINAIS RÁPIDOS ──
  document.querySelectorAll('.btn-palavra').forEach((btn) => {
    btn.addEventListener('click', () => {
      const palavra = btn.getAttribute('data-p');
      if (inputTexto) inputTexto.value = palavra;
      if (AppState.traduzindo) pararTraducaoAtiva();
      iniciarTraducao();
    });
  });

  // ── TELA CÂMERA ──
  document.getElementById('btn-toggle-camera')?.addEventListener('click', toggleCamera);

  const btnEspelhar = document.getElementById('btn-espelhar-camera');
  if (btnEspelhar) {
    btnEspelhar.addEventListener('click', () => {
      cameraEspelhada = !cameraEspelhada;
      const wrap = document.getElementById('camera-wrap');
      if (wrap) wrap.classList.toggle('mirrored', cameraEspelhada);
      btnEspelhar.textContent = cameraEspelhada ? '🪞 Espelhar: ON' : '🪞 Espelhar: OFF';
      btnEspelhar.classList.toggle('ativo', cameraEspelhada);
    });
  }

  document.getElementById('btn-cam-espaco')?.addEventListener('click', () => {
    const el = document.getElementById('texto-detectado');
    if (el && el.textContent && !el.textContent.endsWith(' ')) {
      el.textContent += ' ';
      stabilityBuffer.ultimaLetraConfirmada = '';
    }
  });

  document.getElementById('btn-cam-apagar')?.addEventListener('click', () => {
    const el = document.getElementById('texto-detectado');
    if (el && el.textContent.length > 0) {
      el.textContent = el.textContent.slice(0, -1);
      stabilityBuffer.ultimaLetraConfirmada = '';
    }
  });

  document.getElementById('btn-cam-falar')?.addEventListener('click', () => {
    const el = document.getElementById('texto-detectado');
    if (el && el.textContent.trim()) {
      SpeechService.falarTextoLivre(el.textContent.trim());
    }
  });

  document.getElementById('btn-limpar-cam')?.addEventListener('click', () => {
    const textoEl = document.getElementById('texto-detectado');
    if (textoEl) textoEl.textContent = '';
    const confEl = document.getElementById('conf-fill');
    if (confEl) confEl.style.width = '0%';
    const stabEl = document.getElementById('stab-fill');
    if (stabEl) stabEl.style.width = '0%';
    const lblConf = document.getElementById('lbl-confianca');
    if (lblConf) lblConf.textContent = 'Aguardando gesto...';
    const letraEl = document.getElementById('letra-camera-detectada');
    if (letraEl) letraEl.textContent = '—';
    stabilityBuffer.ultimaLetraConfirmada = '';
  });

  // ── TELA BLUETOOTH & REFERÊNCIA A-Z ──
  document.getElementById('btn-bt-conectar')?.addEventListener('click', () => btManager.conectar());
  document.getElementById('btn-bt-desconectar')?.addEventListener('click', () => btManager.desconectar());

  document.querySelectorAll('#ref-alfabeto-bt .chip').forEach((chip) => {
    chip.classList.add('clickable');
    chip.addEventListener('click', () => {
      const letra = chip.textContent.trim();
      mostrarTela('text');
      timers.schedule(() => visualizarLetraUnica3D(letra), 380);
    });
  });
});

// ============================================================
// 12. BANCO FALLBACK EMBUTIDO (Sincronizado com database.json v4.0)
// ============================================================
function getBancoFallback() {
  const R = {
    A: { c: 'CMD_A', d: 'Punho fechado com polegar na lateral', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.12, y: 0.18, z: -0.20, midX: 0.08 }, indicador: { x: 1.60, y: 0, z: 0.03, midX: 1.68, distX: 1.32 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.32 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.32 }, mindinho: { x: 1.60, y: 0, z: -0.06, midX: 1.68, distX: 1.32 } } },
    B: { c: 'CMD_B', d: 'Quatro dedos estendidos e polegar na palma', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.88, y: -0.38, z: 0.44, midX: 0.98 }, indicador: { x: 0.02, y: 0, z: 0.03, midX: 0.02, distX: 0.02 }, medio: { x: 0.02, y: 0, z: 0, midX: 0.02, distX: 0.02 }, anelar: { x: 0.02, y: 0, z: -0.03, midX: 0.02, distX: 0.02 }, mindinho: { x: 0.02, y: 0, z: -0.06, midX: 0.02, distX: 0.02 } } },
    C: { c: 'CMD_C', d: 'Dedos e polegar curvados em arco C', r: { pulso: { x: 0, y: -0.52, z: 0 }, polegar: { x: 0.58, y: -0.38, z: -0.62, midX: 0.58 }, indicador: { x: 0.64, y: 0, z: 0.04, midX: 0.88, distX: 0.68 }, medio: { x: 0.66, y: 0, z: 0, midX: 0.90, distX: 0.68 }, anelar: { x: 0.66, y: 0, z: -0.04, midX: 0.90, distX: 0.68 }, mindinho: { x: 0.64, y: 0, z: -0.08, midX: 0.86, distX: 0.64 } } },
    D: { c: 'CMD_D', d: 'Indicador estendido, demais tocando polegar', r: { pulso: { x: 0, y: -0.28, z: 0 }, polegar: { x: 0.68, y: -0.32, z: -0.24, midX: 0.58 }, indicador: { x: 0.02, y: 0, z: 0.02, midX: 0.02, distX: 0.02 }, medio: { x: 1.16, y: 0, z: 0, midX: 1.22, distX: 0.92 }, anelar: { x: 1.26, y: 0, z: -0.03, midX: 1.32, distX: 0.96 }, mindinho: { x: 1.32, y: 0, z: -0.06, midX: 1.36, distX: 1.02 } } },
    E: { c: 'CMD_E', d: 'Dedos curvados nas falanges superiores', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.92, y: -0.32, z: 0.30, midX: 0.98 }, indicador: { x: 0.42, y: 0, z: 0.03, midX: 1.58, distX: 1.38 }, medio: { x: 0.42, y: 0, z: 0, midX: 1.58, distX: 1.38 }, anelar: { x: 0.42, y: 0, z: -0.03, midX: 1.58, distX: 1.38 }, mindinho: { x: 0.42, y: 0, z: -0.06, midX: 1.58, distX: 1.38 } } },
    F: { c: 'CMD_F', d: 'Indicador tocando polegar por fora, 3 dedos abertos', r: { pulso: { x: 0, y: -0.12, z: 0 }, polegar: { x: 0.46, y: -0.16, z: -0.32, midX: 0.24 }, indicador: { x: 1.06, y: 0, z: 0.08, midX: 0.96, distX: 0.56 }, medio: { x: 0.03, y: 0, z: 0, midX: 0.03, distX: 0.02 }, anelar: { x: 0.03, y: 0, z: -0.05, midX: 0.03, distX: 0.02 }, mindinho: { x: 0.03, y: 0, z: -0.11, midX: 0.03, distX: 0.02 } } },
    G: { c: 'CMD_G', d: 'Indicador e polegar paralelos apontando para cima', r: { pulso: { x: 0, y: -0.35, z: 0 }, polegar: { x: 0.14, y: 0.10, z: -0.24, midX: 0.05 }, indicador: { x: 0.02, y: 0, z: 0.02, midX: 0.02, distX: 0.02 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    H: { c: 'CMD_H', m: 'giro_pulso', p: 'indicador', d: 'Indicador, médio e polegar com giro de pulso', r: { pulso: { x: 0, y: -0.40, z: 0 }, polegar: { x: 0.45, y: -0.15, z: -0.25, midX: 0.35 }, indicador: { x: 0.02, y: 0, z: 0.16, midX: 0.02, distX: 0.02 }, medio: { x: 0.22, y: 0, z: -0.14, midX: 0.10, distX: 0.05 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    I: { c: 'CMD_I', d: 'Apenas dedo mínimo estendido', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.72, y: -0.22, z: 0.16, midX: 0.68 }, indicador: { x: 1.62, y: 0, z: 0.03, midX: 1.68, distX: 1.30 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 0.02, y: 0, z: -0.04, midX: 0.02, distX: 0.02 } } },
    J: { c: 'CMD_J', m: 'tracar_j', p: 'mindinho', d: 'Dedo mínimo traçando a curva do J no ar', r: { pulso: { x: 0.12, y: -0.25, z: 0.18 }, polegar: { x: 0.72, y: -0.22, z: 0.16, midX: 0.68 }, indicador: { x: 1.62, y: 0, z: 0.03, midX: 1.68, distX: 1.30 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 0.02, y: 0, z: -0.04, midX: 0.02, distX: 0.02 } } },
    K: { c: 'CMD_K', m: 'impulso_cima', p: 'indicador', d: 'Indicador e médio com polegar entre eles impulsionando p/ cima', r: { pulso: { x: -0.14, y: -0.25, z: 0 }, polegar: { x: 0.36, y: -0.15, z: -0.22, midX: 0.20 }, indicador: { x: 0.02, y: 0, z: 0.12, midX: 0.02, distX: 0.02 }, medio: { x: 0.56, y: 0, z: -0.12, midX: 0.15, distX: 0.05 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    L: { c: 'CMD_L', d: 'Indicador e polegar formando ângulo reto (L)', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0, y: 0.22, z: -1.36, midX: 0 }, indicador: { x: 0.02, y: 0, z: 0.02, midX: 0.02, distX: 0.02 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    M: { c: 'CMD_M', d: 'Três dedos unidos apontando para baixo', r: { pulso: { x: 0.38, y: 0, z: 0 }, polegar: { x: 0.86, y: -0.35, z: 0.35, midX: 0.86 }, indicador: { x: 0.96, y: 0, z: 0.03, midX: 0.44, distX: 0.24 }, medio: { x: 0.96, y: 0, z: 0, midX: 0.44, distX: 0.24 }, anelar: { x: 0.96, y: 0, z: -0.03, midX: 0.44, distX: 0.24 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    N: { c: 'CMD_N', d: 'Dois dedos unidos apontando para baixo', r: { pulso: { x: 0.38, y: 0, z: 0 }, polegar: { x: 0.86, y: -0.35, z: 0.25, midX: 0.86 }, indicador: { x: 0.96, y: 0, z: 0.03, midX: 0.44, distX: 0.24 }, medio: { x: 0.96, y: 0, z: 0, midX: 0.44, distX: 0.24 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    O: { c: 'CMD_O', d: 'Dedos curvados formando um círculo com o polegar', r: { pulso: { x: 0, y: -0.48, z: 0 }, polegar: { x: 0.74, y: -0.42, z: -0.40, midX: 0.72 }, indicador: { x: 0.96, y: 0, z: 0.04, midX: 1.16, distX: 0.86 }, medio: { x: 0.98, y: 0, z: 0, midX: 1.18, distX: 0.86 }, anelar: { x: 0.96, y: 0, z: -0.04, midX: 1.16, distX: 0.86 }, mindinho: { x: 0.92, y: 0, z: -0.08, midX: 1.12, distX: 0.82 } } },
    P: { c: 'CMD_P', d: 'Configuração de K inclinada na horizontal', r: { pulso: { x: 0.96, y: -0.35, z: -0.25 }, polegar: { x: 0.36, y: -0.15, z: -0.22, midX: 0.20 }, indicador: { x: 0.02, y: 0, z: 0.12, midX: 0.02, distX: 0.02 }, medio: { x: 0.65, y: 0, z: -0.10, midX: 0.15, distX: 0.05 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    Q: { c: 'CMD_Q', d: 'Configuração de G apontando para baixo', r: { pulso: { x: 1.18, y: 0, z: 0 }, polegar: { x: 0.20, y: 0.10, z: -0.25, midX: 0.05 }, indicador: { x: 0.15, y: 0, z: 0.02, midX: 0.05, distX: 0.02 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    R: { c: 'CMD_R', d: 'Indicador e médio estendidos e cruzados', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.85, y: -0.25, z: 0.25, midX: 0.80 }, indicador: { x: 0.08, y: 0.16, z: -0.19, midX: 0.05, distX: 0.05 }, medio: { x: -0.04, y: -0.16, z: 0.19, midX: 0.12, distX: 0.08 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    S: { c: 'CMD_S', d: 'Punho fechado com polegar cruzado à frente', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.78, y: -0.36, z: 0.30, midX: 0.88 }, indicador: { x: 1.62, y: 0, z: 0.03, midX: 1.68, distX: 1.30 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    T: { c: 'CMD_T', d: 'Indicador flexionado por trás do polegar, 3 dedos estendidos', r: { pulso: { x: 0, y: -0.10, z: 0 }, polegar: { x: 0.56, y: -0.10, z: -0.08, midX: 0.26 }, indicador: { x: 1.12, y: 0, z: -0.06, midX: 1.06, distX: 0.66 }, medio: { x: 0.03, y: 0, z: 0, midX: 0.03, distX: 0.02 }, anelar: { x: 0.03, y: 0, z: -0.05, midX: 0.03, distX: 0.02 }, mindinho: { x: 0.03, y: 0, z: -0.12, midX: 0.03, distX: 0.02 } } },
    U: { c: 'CMD_U', d: 'Indicador e médio estendidos e unidos', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.86, y: -0.26, z: 0.26, midX: 0.86 }, indicador: { x: 0.02, y: 0, z: -0.04, midX: 0.02, distX: 0.02 }, medio: { x: 0.02, y: 0, z: 0.04, midX: 0.02, distX: 0.02 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    V: { c: 'CMD_V', d: 'Indicador e médio estendidos e afastados em V', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.86, y: -0.26, z: 0.26, midX: 0.86 }, indicador: { x: 0.02, y: 0, z: 0.24, midX: 0.02, distX: 0.02 }, medio: { x: 0.02, y: 0, z: -0.22, midX: 0.02, distX: 0.02 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    W: { c: 'CMD_W', d: 'Três dedos estendidos e separados em W', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0.86, y: -0.26, z: 0.30, midX: 0.86 }, indicador: { x: 0.02, y: 0, z: 0.26, midX: 0.02, distX: 0.02 }, medio: { x: 0.02, y: 0, z: 0, midX: 0.02, distX: 0.02 }, anelar: { x: 0.02, y: 0, z: -0.26, midX: 0.02, distX: 0.02 }, mindinho: { x: 1.62, y: 0, z: -0.08, midX: 1.68, distX: 1.30 } } },
    X: { c: 'CMD_X', m: 'puxar_x', p: 'indicador', d: 'Indicador em gancho puxando levemente', r: { pulso: { x: 0, y: -0.35, z: 0 }, polegar: { x: 0.72, y: -0.20, z: 0.15, midX: 0.66 }, indicador: { x: 0.24, y: 0, z: 0.02, midX: 1.48, distX: 1.28 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } },
    Y: { c: 'CMD_Y', d: 'Polegar e dedo mínimo estendidos', r: { pulso: { x: 0, y: 0, z: 0 }, polegar: { x: 0, y: 0.22, z: -1.36, midX: 0 }, indicador: { x: 1.62, y: 0, z: 0.03, midX: 1.68, distX: 1.30 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 0.02, y: 0, z: -0.18, midX: 0.02, distX: 0.02 } } },
    Z: { c: 'CMD_Z', m: 'tracar_z', p: 'indicador', d: 'Indicador traçando a letra Z no ar', r: { pulso: { x: 0.08, y: 0, z: 0 }, polegar: { x: 0.76, y: -0.25, z: 0.20, midX: 0.76 }, indicador: { x: 0.02, y: 0, z: 0.02, midX: 0.02, distX: 0.02 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 1.62, y: 0, z: -0.06, midX: 1.68, distX: 1.30 } } }
  };

  const letras = {};
  for (const k of Object.keys(R)) {
    letras[k] = {
      comando: R[k].c,
      descricao: R[k].d,
      movimento: R[k].m || null,
      pontaRastro: R[k].p || null,
      rotacoes3d: R[k].r
    };
  }

  return {
    versao: '4.0.0',
    letras,
    palavras: {
      AJUDA:       { duas_maos: true,  comando: 'CMD_AJUDA',    movimento: 'ajuda',          descricao: 'Mão aberta apoiando e impulsionando a outra para frente', mao_direita: { rotacoes3d: R.B.r }, mao_esquerda: { rotacoes3d: R.B.r } },
      OBRIGADO:    { duas_maos: false, comando: 'CMD_OBRIGADO', movimento: 'obrigado',       pontaRastro: 'medio', descricao: 'Mão em B partindo da testa/queixo para frente', mao_direita: { rotacoes3d: R.B.r }, mao_esquerda: null },
      AGUA:        { duas_maos: false, comando: 'CMD_AGUA',     movimento: 'agua_libras',    pontaRastro: 'indicador', descricao: 'Mão em L (Libras oficial) com indicador batendo duas vezes', mao_direita: { rotacoes3d: R.L.r }, mao_esquerda: null },
      BANHEIRO:    { duas_maos: false, comando: 'CMD_BANHEIRO', movimento: 'oscilar_pulso',  descricao: 'Sinal de banheiro com oscilação lateral', mao_direita: { rotacoes3d: R.T.r }, mao_esquerda: null },
      SOCORRO:     { duas_maos: true,  comando: 'CMD_SOCORRO',  movimento: 'alerta_duplo',   descricao: 'Ambas as mãos em alerta pedindo socorro', mao_direita: { rotacoes3d: R.B.r }, mao_esquerda: { rotacoes3d: R.B.r } },
      COMIDA:      { duas_maos: false, comando: 'CMD_COMIDA',   movimento: 'comida_libras',  descricao: 'Dedos unidos em pinça levando à boca', mao_direita: { rotacoes3d: R.O.r }, mao_esquerda: null },
      PERIGO:      { duas_maos: true,  comando: 'CMD_PERIGO',   movimento: 'perigo',         descricao: 'Sinal de perigo/cuidado com movimento de alerta', mao_direita: { rotacoes3d: R.Y.r }, mao_esquerda: { rotacoes3d: R.Y.r } },
      'POR FAVOR': { duas_maos: false, comando: 'CMD_PORFAVOR', movimento: 'circular_peito', pontaRastro: 'medio', descricao: 'Mão aberta fazendo movimento circular no peito', mao_direita: { rotacoes3d: R.B.r }, mao_esquerda: null },
      SIM:         { duas_maos: false, comando: 'CMD_SIM',      movimento: 'sim_aceno',      descricao: 'Punho em S acenando positivamente', mao_direita: { rotacoes3d: R.S.r }, mao_esquerda: null },
      NAO:         { duas_maos: false, comando: 'CMD_NAO',      movimento: 'nao_abano',      pontaRastro: 'indicador', descricao: 'Indicador estendido abanando negativamente', mao_direita: { rotacoes3d: R.D.r }, mao_esquerda: null }
    },
    configuracoes: { intervaloBetweenLetras: 850, tempoTransicao3d: 600, debounceCamera: 1650 }
  };
}
