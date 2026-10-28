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
  vozAtiva: false,
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
// 3. SERVIÇO DE SÍNTESE DE VOZ EM PORTUGUÊS DO BRASIL (pt-BR)
// ============================================================
const DICIONARIO_FONETICO_PTBR = Object.freeze({
  ola: 'olá',
  oi: 'oi',
  voce: 'você',
  voces: 'vocês',
  nao: 'não',
  sim: 'sim',
  agua: 'água',
  esta: 'está',
  estao: 'estão',
  tambem: 'também',
  alguem: 'alguém',
  ninguem: 'ninguém',
  ate: 'até',
  ja: 'já',
  so: 'só',
  nos: 'nós',
  la: 'lá',
  ca: 'cá',
  ai: 'aí',
  cafe: 'café',
  pao: 'pão',
  mae: 'mãe',
  irmao: 'irmão',
  irma: 'irmã',
  coracao: 'coração',
  atencao: 'atenção',
  informacao: 'informação',
  comunicacao: 'comunicação',
  traducao: 'tradução',
  educacao: 'educação',
  mao: 'mão',
  maos: 'mãos',
  robo: 'robô',
  bionica: 'biônica',
  medico: 'médico',
  medica: 'médica',
  remedio: 'remédio',
  emergencia: 'emergência',
  ambulancia: 'ambulância',
  policia: 'polícia',
  familia: 'família',
  horario: 'horário',
  necessario: 'necessário',
  numero: 'número',
  onibus: 'ônibus',
  sanitario: 'sanitário',
  comecar: 'começar',
  cabeca: 'cabeça',
  braco: 'braço',
  pescoco: 'pescoço',
  almoco: 'almoço',
  licenca: 'licença',
  crianca: 'criança',
  doenca: 'doença',
  esperanca: 'esperança',
  seguranca: 'segurança',
  forca: 'força',
  saude: 'saúde',
  dificil: 'difícil',
  facil: 'fácil',
  rapido: 'rápido',
  proximo: 'próximo',
  ultimo: 'último',
  otimo: 'ótimo',
  pessimo: 'péssimo',
  duvida: 'dúvida',
  musica: 'música',
  publico: 'público',
  unico: 'único',
  silencio: 'silêncio',
  paciencia: 'paciência',
  urgencia: 'urgência'
});

const SpeechService = {
  _melhorVozPtBr: null,
  _inicializado: false,

  init() {
    if (this._inicializado || !('speechSynthesis' in window)) return;
    this._inicializado = true;
    this._atualizarVozPtBr();
    try {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        this._atualizarVozPtBr();
      });
    } catch (_) {
      window.speechSynthesis.onvoiceschanged = () => this._atualizarVozPtBr();
    }
  },

  _atualizarVozPtBr() {
    if (!('speechSynthesis' in window)) return null;
    const vozes = window.speechSynthesis.getVoices() || [];
    if (!vozes.length) return null;

    let melhor = null;
    let maiorScore = -1;

    for (const v of vozes) {
      const langNorm = String(v.lang || '').replace('_', '-').toLowerCase();
      const nomeNorm = String(v.name || '').toLowerCase();

      const ehPt =
        langNorm.startsWith('pt') ||
        nomeNorm.includes('portugu') ||
        nomeNorm.includes('brasil') ||
        nomeNorm.includes('brazil');

      if (!ehPt) continue;

      let score = 10;
      if (langNorm === 'pt-br' || langNorm.startsWith('pt-br')) score += 100;
      else if (nomeNorm.includes('brasil') || nomeNorm.includes('brazil')) score += 90;
      else if (langNorm.startsWith('pt')) score += 30;

      // Prioriza vozes neurais/naturais de alta definição em pt-BR
      if (nomeNorm.includes('natural') || nomeNorm.includes('neural') || nomeNorm.includes('online')) score += 50;
      if (nomeNorm.includes('google')) score += 40;
      if (
        nomeNorm.includes('francisca') ||
        nomeNorm.includes('antonio') ||
        nomeNorm.includes('thalita') ||
        nomeNorm.includes('luciana') ||
        nomeNorm.includes('felipe') ||
        nomeNorm.includes('maria') ||
        nomeNorm.includes('daniel')
      ) {
        score += 35;
      }

      if (score > maiorScore) {
        maiorScore = score;
        melhor = v;
      }
    }

    this._melhorVozPtBr = melhor;
    return melhor;
  },

  /**
   * Converte texto em caixa-alta/sem acentos para português brasileiro natural em minúsculas
   * com acentuação restaurada, evitando que motores TTS leiam palavras como siglas em inglês.
   */
  normalizarTextoPtBr(texto) {
    const base = String(texto || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (!base) return '';

    const palavras = base.split(' ');
    const corrigidas = palavras.map((p, idx) => {
      const limpa = p.replace(/[^a-zà-úç]/g, '');
      if (!limpa) return p;

      if (DICIONARIO_FONETICO_PTBR[limpa]) {
        return DICIONARIO_FONETICO_PTBR[limpa];
      }

      // Conjunção/verbo "e" isolado no meio de frase: pronúncia natural em pt-BR
      if (limpa === 'e' && palavras.length > 1 && idx > 0) {
        return 'e';
      }

      // Restauração fonética de sufixos frequentes digitados sem acento (-cao -> -ção, -coes -> -ções)
      if (limpa.length > 4 && limpa.endsWith('cao')) {
        return limpa.slice(0, -3) + 'ção';
      }
      if (limpa.length > 5 && limpa.endsWith('coes')) {
        return limpa.slice(0, -4) + 'ções';
      }

      return limpa;
    });

    return corrigidas.join(' ');
  },

  falar(chave, opcoes = {}) {
    const forcar = Boolean(opcoes.forcar);
    if ((!AppState.vozAtiva && !forcar) || !('speechSynthesis' in window)) return;
    const chaveUpper = String(chave || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
    const textoFala = MAPA_FONETICO[chaveUpper] || this.normalizarTextoPtBr(chave);
    this._executarSintese(textoFala);
  },

  falarTextoLivre(texto, opcoes = {}) {
    const forcar = Boolean(opcoes.forcar);
    if ((!AppState.vozAtiva && !forcar) || !('speechSynthesis' in window) || !texto) return;

    const textoLimpo = String(texto).trim();
    if (!textoLimpo) return;

    // Se for apenas 1 letra isolada, usa o mapa fonético da letra em português
    const semAcentoUpper = textoLimpo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    if (semAcentoUpper.length === 1 && MAPA_FONETICO[semAcentoUpper]) {
      this._executarSintese(MAPA_FONETICO[semAcentoUpper]);
      return;
    }

    const frasePtBr = this.normalizarTextoPtBr(textoLimpo);
    this._executarSintese(frasePtBr);
  },

  _executarSintese(textoFala) {
    if (!textoFala || !('speechSynthesis' in window)) return;
    try {
      this.init();
      window.speechSynthesis.cancel();

      const disparar = () => {
        const utt = new SpeechSynthesisUtterance(textoFala);
        const vozPt = this._melhorVozPtBr || this._atualizarVozPtBr();

        if (vozPt) {
          utt.voice = vozPt;
          utt.lang = vozPt.lang ? vozPt.lang.replace('_', '-') : 'pt-BR';
        } else {
          utt.lang = 'pt-BR';
        }

        utt.rate = Math.min(Math.max(0.95 * AppState.velocidadeTraducao, 0.75), 1.35);
        utt.pitch = 1.0;
        utt.volume = 1.0;

        window.speechSynthesis.speak(utt);
      };

      // Se as vozes do navegador ainda não carregaram, aguarda brevemente antes de falar
      const vozesAtuais = window.speechSynthesis.getVoices();
      if (!vozesAtuais || vozesAtuais.length === 0) {
        setTimeout(disparar, 120);
      } else {
        disparar();
      }
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
// ============================================================
// 4. GERENCIADOR BLUETOOTH BLE UNIFICADO (Delega p/ window.libratronicBT c/ 18-byte chunking + anti-colisão)
// ============================================================
class BluetoothManager {
  constructor() {
    this.conectado = false;
    this.conectando = false;
  }

  async conectar() {
    if (window.libratronicBT) {
      return await window.libratronicBT.conectar();
    }
    mostrarNotificacaoUI('Módulo Bluetooth não encontrado.', 'error');
    return false;
  }

  desconectar() {
    if (window.libratronicBT) {
      window.libratronicBT.desconectar();
    }
    this.conectado = false;
    this.conectando = false;
    this.atualizarUI('disconnected', 'Conectar ESP32');
  }

  enviar(comando) {
    if (!comando || !window.libratronicBT) return;
    const cmdStr = String(comando).trim().toUpperCase();

    if (cmdStr === 'CMD_REPOUSO' || cmdStr === 'CMD_ESPACO' || cmdStr === 'REST' || cmdStr === 'RESET') {
      if (window.tecladoDatilografo) {
        window.tecladoDatilografo.aplicarRepouso(true);
      } else {
        window.libratronicBT.enviarRepouso();
      }
      return;
    }

    let letra = null;
    if (/^CMD_[A-Z]$/.test(cmdStr)) {
      letra = cmdStr.charAt(4);
    } else if (/^[A-Z]$/.test(cmdStr)) {
      letra = cmdStr;
    }

    if (letra) {
      if (window.tecladoDatilografo) {
        window.tecladoDatilografo.sincronizarLetraUI(letra, true);
      } else {
        window.libratronicBT.enviarLetra(letra);
      }
      return;
    }

    const mapaSinaisParaLetra = {
      CMD_AJUDA: 'B',
      CMD_OBRIGADO: 'B',
      CMD_AGUA: 'L',
      CMD_BANHEIRO: 'T',
      CMD_SOCORRO: 'B',
      CMD_COMIDA: 'O',
      CMD_PERIGO: 'Y',
      CMD_PORFAVOR: 'B',
      CMD_SIM: 'S',
      CMD_NAO: 'D'
    };
    if (mapaSinaisParaLetra[cmdStr]) {
      const lBase = mapaSinaisParaLetra[cmdStr];
      if (window.tecladoDatilografo) {
        window.tecladoDatilografo.sincronizarLetraUI(lBase, true);
      } else {
        window.libratronicBT.enviarLetra(lBase);
      }
      return;
    }

    window.libratronicBT._enfileirarComando(`<${cmdStr}>`, { tipo: 'custom' });
  }

  atualizarUI(estado, texto) {
    const isConnected = estado === 'connected' || estado === 'conectado';
    const isConnecting = estado === 'connecting' || estado === 'conectando';
    this.conectado = isConnected;
    this.conectando = isConnecting;

    document.querySelectorAll('.bt-dot').forEach((el) => {
      el.className =
        'bt-dot' +
        (isConnected ? ' connected' : '') +
        (isConnecting ? ' connecting' : '');
    });

    const labelPadrao = isConnected ? (texto || 'ESP32 Online') : isConnecting ? 'Conectando...' : 'Conectar ESP32';
    document.querySelectorAll('.bt-status-text').forEach((el) => {
      el.textContent = labelPadrao;
    });

    const nomeEl = document.getElementById('bt-device-name');
    if (nomeEl) {
      nomeEl.textContent = isConnected ? `Conectado: ${texto}` : isConnecting ? 'Conectando ao ESP32...' : 'ESP32 desconectado';
    }
  }
}

const btManager = new BluetoothManager();
// ============================================================
// 5. VISÃO COMPUTACIONAL IA: FILTRO EMA + GATE TEMPORAL (0.85s) + TRAJETÓRIA J/Z
// ============================================================

/**
 * Calcula o ângulo articular em graus (0° a 180°) formado por 3 pontos (A -> B -> C).
 * 180° = articulação totalmente reta/estendida; < 130° = articulação flexionada/curvada.
 */
function anguloArticulacao(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = ((a.z || 0) - (b.z || 0)) * 0.35;

  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = ((c.z || 0) - (b.z || 0)) * 0.35;

  const mag1 = Math.hypot(v1x, v1y, v1z);
  const mag2 = Math.hypot(v2x, v2y, v2z);
  if (mag1 < 1e-5 || mag2 < 1e-5) return 180;

  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y + v1z * v2z) / (mag1 * mag2)));
  return Math.acos(cos) * (180 / Math.PI);
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Suaviza coordenadas 2D/3D dos 21 landmarks via Exponential Moving Average (EMA)
 * para eliminar micro-tremores da webcam antes da classificação geométrica.
 */
class LandmarkSmoother {
  constructor(alpha = 0.55) {
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
 * Motor Temporal Anti-Spam + Reconhecedor de Trajetórias Dinâmicas (J e Z):
 *  - Exige sustentação real de ~0.85s (850ms) na mesma letra com a mão estável
 *    para confirmar, eliminando o spam de letras enquanto o utilizador move a mão.
 *  - Monitora a velocidade cinemática do pulso/palma para pausar o acumulador
 *    durante transições rápidas de postura.
 *  - Analisa janelas temporais contínuas (1.1s) da ponta do indicador e do mindinho
 *    invariantes à rotação de pulso para capturar o traçado espacial de 'J' e 'Z'.
 */
class GestureStabilityBuffer {
  constructor(tempoHoldMs = 850) {
    this.tempoHoldMs = tempoHoldMs; // 0.85s (dentro do intervalo 0.75s - 1.0s)
    this.cooldownNovaLetraMs = 800; // Bloqueio pós-confirmação contra spam
    this.cooldownMesmaLetraMs = 1850;

    this.historico = [];
    this.maxHistorico = 9;
    this.letraCandidata = '';
    this.tempoAcumuladoMs = 0;
    this.ultimoFrameTs = 0;

    this.ultimaLetraConfirmada = '';
    this.tsUltimaConfirmacao = 0;

    // Estado cinemático anterior para cálculo de velocidade da mão
    this.prevPulso = null;
    this.prevCentro = null;
    this.velocidadeMao = 0;

    // Buffers temporais de trajetória (últimos 1150ms) para J e Z
    this.janelaTrilhaMs = 1150;
    this.trilhaIndicador = [];
    this.trilhaMindinho = [];
    this.gestoDinamicoAtivo = null; // { letra: 'J'|'Z', expiraEm: number }
  }

  reset() {
    this.historico = [];
    this.letraCandidata = '';
    this.tempoAcumuladoMs = 0;
    this.ultimoFrameTs = 0;
    this.prevPulso = null;
    this.prevCentro = null;
    this.velocidadeMao = 0;
    this.trilhaIndicador = [];
    this.trilhaMindinho = [];
    this.gestoDinamicoAtivo = null;
  }

  registrarPontosTrajetoria(lm) {
    if (!lm || lm.length < 21) return;
    const agora = performance.now();
    const tamMao = dist2D(lm[0], lm[9]) || 0.1;

    // 1. Calcula velocidade normalizada da mão (comprimentos de palma / segundo)
    if (this.prevPulso && this.prevCentro && this.ultimoFrameTs > 0) {
      const dtSec = Math.max((agora - this.ultimoFrameTs) / 1000, 0.008);
      const dPulso = dist2D(lm[0], this.prevPulso) / tamMao;
      const dCentro = dist2D(lm[9], this.prevCentro) / tamMao;
      const velInst = ((dPulso + dCentro) * 0.5) / dtSec;
      this.velocidadeMao = this.velocidadeMao * 0.55 + velInst * 0.45;
    } else {
      this.velocidadeMao = 0;
    }
    this.prevPulso = { x: lm[0].x, y: lm[0].y };
    this.prevCentro = { x: lm[9].x, y: lm[9].y };

    // 2. Avalia configuração de dedos invariante à inclinação do pulso (para J e Z em movimento)
    const angInd = anguloArticulacao(lm[5], lm[6], lm[7]);
    const angMed = anguloArticulacao(lm[9], lm[10], lm[11]);
    const angAne = anguloArticulacao(lm[13], lm[14], lm[15]);
    const angMin = anguloArticulacao(lm[17], lm[18], lm[19]);

    const distInd = dist2D(lm[8], lm[5]) / tamMao;
    const distMed = dist2D(lm[12], lm[9]) / tamMao;
    const distAne = dist2D(lm[16], lm[13]) / tamMao;
    const distMin = dist2D(lm[20], lm[17]) / tamMao;

    // Pose compatível com traçado de Z: apenas indicador estendido e médio/anelar/mindinho recolhidos
    const poseParaZ =
      (angInd > 132 || distInd > 0.56) &&
      angMed < 135 &&
      angAne < 142 &&
      angMin < 142 &&
      distInd > distMed * 1.15 &&
      distInd > distAne * 1.22;

    // Pose compatível com traçado de J: mindinho estendido e indicador/médio/anelar recolhidos
    const poseParaJ =
      (angMin > 128 || distMin > 0.48) &&
      angInd < 138 &&
      angMed < 138 &&
      distMin > distInd * 1.12;

    this.trilhaIndicador.push({
      x: lm[8].x,
      y: lm[8].y,
      t: agora,
      scale: tamMao,
      valido: poseParaZ
    });

    this.trilhaMindinho.push({
      x: lm[20].x,
      y: lm[20].y,
      t: agora,
      scale: tamMao,
      valido: poseParaJ
    });

    // Expurga amostras mais antigas que a janela de 1150ms
    const corte = agora - this.janelaTrilhaMs;
    while (this.trilhaIndicador.length > 0 && this.trilhaIndicador[0].t < corte) {
      this.trilhaIndicador.shift();
    }
    while (this.trilhaMindinho.length > 0 && this.trilhaMindinho[0].t < corte) {
      this.trilhaMindinho.shift();
    }
  }

  /**
   * Analisa a assinatura geométrica espacial para detectar 'J' e 'Z' durante o movimento.
   */
  detectarMovimentoDinamico(agora) {
    if (this.gestoDinamicoAtivo && agora < this.gestoDinamicoAtivo.expiraEm) {
      return this.gestoDinamicoAtivo.letra;
    }
    this.gestoDinamicoAtivo = null;

    // ── AVALIAÇÃO DE TRAJETÓRIA 'Z' (Zigue-zague com o indicador) ──
    if (this.trilhaIndicador.length >= 8) {
      const validosZ = this.trilhaIndicador.filter((p) => p.valido).length;
      if (validosZ / this.trilhaIndicador.length >= 0.58) {
        const scale = this.trilhaIndicador[this.trilhaIndicador.length - 1].scale || 0.1;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let compTrilha = 0;
        let inversoesX = 0;
        let dirXAtual = 0;
        let ancoraX = this.trilhaIndicador[0].x;

        for (let i = 0; i < this.trilhaIndicador.length; i++) {
          const pt = this.trilhaIndicador[i];
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;

          if (i > 0) {
            const ant = this.trilhaIndicador[i - 1];
            compTrilha += Math.hypot(pt.x - ant.x, pt.y - ant.y);
          }

          const deltaAncora = (pt.x - ancoraX) / scale;
          if (Math.abs(deltaAncora) > 0.12) {
            const novaDir = Math.sign(deltaAncora);
            if (dirXAtual !== 0 && novaDir !== dirXAtual) {
              inversoesX++;
            }
            dirXAtual = novaDir;
            ancoraX = pt.x;
          }
        }

        const ini = this.trilhaIndicador[0];
        const fim = this.trilhaIndicador[this.trilhaIndicador.length - 1];
        const ampX = (maxX - minX) / scale;
        const ampY = (maxY - minY) / scale;
        const compNorm = compTrilha / scale;
        const distDireta = Math.hypot(fim.x - ini.x, fim.y - ini.y) / scale;
        const tortuosidade = compNorm / Math.max(distDireta, 0.08);

        if (
          ampX >= 0.30 &&
          ampY >= 0.17 &&
          compNorm >= 0.65 &&
          (inversoesX >= 1 || tortuosidade >= 1.32)
        ) {
          this.gestoDinamicoAtivo = { letra: 'Z', expiraEm: agora + 750 };
          this.trilhaIndicador = [];
          return 'Z';
        }
      }
    }

    // ── AVALIAÇÃO DE TRAJETÓRIA 'J' (Descida vertical + gancho em curva com o mindinho) ──
    if (this.trilhaMindinho.length >= 7) {
      const validosJ = this.trilhaMindinho.filter((p) => p.valido).length;
      if (validosJ / this.trilhaMindinho.length >= 0.55) {
        const scale = this.trilhaMindinho[this.trilhaMindinho.length - 1].scale || 0.1;
        let minX = Infinity, maxX = -Infinity;
        let compTrilha = 0;

        let idxTopo = 0;
        for (let i = 0; i < this.trilhaMindinho.length; i++) {
          const pt = this.trilhaMindinho[i];
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (i > 0) {
            const ant = this.trilhaMindinho[i - 1];
            compTrilha += Math.hypot(pt.x - ant.x, pt.y - ant.y);
          }
          if (i <= Math.floor(this.trilhaMindinho.length * 0.65) && pt.y < this.trilhaMindinho[idxTopo].y) {
            idxTopo = i;
          }
        }

        let idxFundo = idxTopo;
        for (let i = idxTopo; i < this.trilhaMindinho.length; i++) {
          if (this.trilhaMindinho[i].y > this.trilhaMindinho[idxFundo].y) {
            idxFundo = i;
          }
        }

        const ptTopo = this.trilhaMindinho[idxTopo];
        const ptFundo = this.trilhaMindinho[idxFundo];
        const ptFim = this.trilhaMindinho[this.trilhaMindinho.length - 1];

        const descidaY = (ptFundo.y - ptTopo.y) / scale;
        const ampX = (maxX - minX) / scale;
        const desvioLateral = Math.abs(ptFim.x - ptTopo.x) / scale;
        const compNorm = compTrilha / scale;

        if (
          descidaY >= 0.20 &&
          ampX >= 0.12 &&
          compNorm >= 0.34 &&
          (desvioLateral >= 0.11 || (ptFundo.y - ptFim.y) / scale >= 0.03)
        ) {
          this.gestoDinamicoAtivo = { letra: 'J', expiraEm: agora + 750 };
          this.trilhaMindinho = [];
          return 'J';
        }
      }
    }

    return null;
  }

  /**
   * Retorna os pontos ativos de rastro para feedback visual no canvas da câmera.
   */
  obterTrilhaAtivaVisual() {
    if (this.trilhaIndicador.length >= 3) {
      const ult = this.trilhaIndicador[this.trilhaIndicador.length - 1];
      if (ult.valido) return this.trilhaIndicador;
    }
    if (this.trilhaMindinho.length >= 3) {
      const ult = this.trilhaMindinho[this.trilhaMindinho.length - 1];
      if (ult.valido) return this.trilhaMindinho;
    }
    return null;
  }

  processarPredicao(predicaoBruta) {
    const agora = performance.now();
    const dt = this.ultimoFrameTs > 0 ? Math.min(agora - this.ultimoFrameTs, 120) : 33;
    this.ultimoFrameTs = agora;

    // 1. Verifica primeiro se um movimento dinâmico (J ou Z) acabou de se completar
    const letraDinamica = this.detectarMovimentoDinamico(agora);
    if (letraDinamica) {
      const tempoDesdeUltima = agora - this.tsUltimaConfirmacao;
      const podeConfirmarDinamica =
        this.ultimaLetraConfirmada !== letraDinamica ||
        tempoDesdeUltima >= this.cooldownNovaLetraMs;

      this.letraCandidata = letraDinamica;
      this.tempoAcumuladoMs = this.tempoHoldMs;

      if (podeConfirmarDinamica) {
        this.ultimaLetraConfirmada = letraDinamica;
        this.tsUltimaConfirmacao = agora;
        this.tempoAcumuladoMs = 0;
        this.gestoDinamicoAtivo = null;
        return {
          letra: letraDinamica,
          confianca: 0.94,
          estabilidadePct: 100,
          confirmada: true,
          novaLetra: true
        };
      }
    }

    // 2. Se a mão está em período de bloqueio pós-confirmação (anti-spam)
    const desdeConfirmacao = agora - this.tsUltimaConfirmacao;
    if (this.tsUltimaConfirmacao > 0 && desdeConfirmacao < this.cooldownNovaLetraMs) {
      this.tempoAcumuladoMs = 0;
      return {
        letra: this.ultimaLetraConfirmada || (predicaoBruta ? predicaoBruta.letra : ''),
        confianca: predicaoBruta ? predicaoBruta.confianca : 0,
        estabilidadePct: 0,
        confirmada: false,
        emCooldown: true
      };
    }

    // 3. Postura neutra (palma aberta em repouso) ou sem predição confiável -> decaimento rápido
    if (!predicaoBruta || predicaoBruta.neutro || !predicaoBruta.letra || predicaoBruta.confianca < 0.70) {
      const taxaDecaimento = predicaoBruta?.neutro ? 2.8 : 1.35;
      this.tempoAcumuladoMs = Math.max(0, this.tempoAcumuladoMs - dt * taxaDecaimento);
      if (this.tempoAcumuladoMs === 0) {
        this.letraCandidata = '';
        this.historico = [];
        if (predicaoBruta?.neutro) {
          // Abrir a palma em repouso libera para repetir qualquer letra em seguida
          this.ultimaLetraConfirmada = '';
        }
      }
      return {
        letra: this.letraCandidata,
        confianca: predicaoBruta && !predicaoBruta.neutro ? predicaoBruta.confianca : 0,
        estabilidadePct: Math.round((this.tempoAcumuladoMs / this.tempoHoldMs) * 100),
        confirmada: false,
        neutro: Boolean(predicaoBruta?.neutro)
      };
    }

    // 4. Janela de votação majoritária para filtrar ruído pontual de 1-2 frames
    this.historico.push(predicaoBruta.letra);
    if (this.historico.length > this.maxHistorico) {
      this.historico.shift();
    }

    const contagem = {};
    let letraDominante = predicaoBruta.letra;
    let maiorVoto = 0;
    for (const l of this.historico) {
      contagem[l] = (contagem[l] || 0) + 1;
      if (contagem[l] > maiorVoto) {
        maiorVoto = contagem[l];
        letraDominante = l;
      }
    }

    // 5. Filtro de Velocidade da Mão (impede confirmar letras enquanto a mão está se movendo)
    const limiarVelocidade =
      letraDominante === 'I' || letraDominante === 'D' || letraDominante === 'G' ? 0.95 : 1.45;

    if (this.velocidadeMao > limiarVelocidade) {
      // Mão em movimento: pausa/reduz levemente o acumulador estático para evitar spam
      this.tempoAcumuladoMs = Math.max(0, this.tempoAcumuladoMs - dt * 0.5);
    } else if (letraDominante === this.letraCandidata) {
      // Mão firme na mesma letra: acumula tempo real até atingir 850ms (0.85s)
      this.tempoAcumuladoMs = Math.min(this.tempoHoldMs, this.tempoAcumuladoMs + dt);
    } else {
      // Mudou de postura: reduz acumulador rapidamente antes de trocar a candidata
      this.tempoAcumuladoMs = Math.max(0, this.tempoAcumuladoMs - dt * 2.2);
      if (this.tempoAcumuladoMs <= 60) {
        this.letraCandidata = letraDominante;
        this.tempoAcumuladoMs = Math.min(dt, 40);
      }
    }

    const estabilidadePct = Math.min(
      100,
      Math.round((this.tempoAcumuladoMs / this.tempoHoldMs) * 100)
    );

    let confirmada = false;
    let novaLetra = false;

    if (this.tempoAcumuladoMs >= this.tempoHoldMs) {
      novaLetra = this.letraCandidata !== this.ultimaLetraConfirmada;
      const podeRepetirMesma = desdeConfirmacao >= this.cooldownMesmaLetraMs;

      if (novaLetra || podeRepetirMesma) {
        this.ultimaLetraConfirmada = this.letraCandidata;
        this.tsUltimaConfirmacao = agora;
        this.tempoAcumuladoMs = 0; // Reseta barra após confirmar para exigir novo hold de 0.85s
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
// 6. CLASSIFICADOR BIOMECÂNICO DE LIBRAS (Ângulos Articulares + Vetores)
// ============================================================
function reconhecerConfiguracao(lm) {
  const tamMao = dist2D(lm[0], lm[9]);
  if (tamMao < 0.02) return null;

  // 1. Ângulos articulares PIP (MCP-PIP-DIP) e DIP (PIP-DIP-TIP) em graus (0..180)
  const angPIP_I  = anguloArticulacao(lm[5],  lm[6],  lm[7]);
  const angPIP_M  = anguloArticulacao(lm[9],  lm[10], lm[11]);
  const angPIP_A  = anguloArticulacao(lm[13], lm[14], lm[15]);
  const angPIP_Mi = anguloArticulacao(lm[17], lm[18], lm[19]);

  const angDIP_I  = anguloArticulacao(lm[6],  lm[7],  lm[8]);
  const angDIP_M  = anguloArticulacao(lm[10], lm[11], lm[12]);
  const angDIP_A  = anguloArticulacao(lm[14], lm[15], lm[16]);
  const angDIP_Mi = anguloArticulacao(lm[18], lm[19], lm[20]);

  // 2. Estado de extensão vertical dos 4 dedos (dedos apontando para cima)
  const I  = lm[8].y  < lm[6].y  - tamMao * 0.10 && lm[6].y  < lm[5].y  && angPIP_I  > 138;
  const M  = lm[12].y < lm[10].y - tamMao * 0.10 && lm[10].y < lm[9].y  && angPIP_M  > 138;
  const A  = lm[16].y < lm[14].y - tamMao * 0.10 && lm[14].y < lm[13].y && angPIP_A  > 138;
  const Mi = lm[20].y < lm[18].y - tamMao * 0.08 && lm[18].y < lm[17].y && angPIP_Mi > 135;

  // 3. Abertura e posição do polegar + geometria da palma
  const distPolMind      = dist2D(lm[4], lm[17]) / tamMao;
  const distBaseMind     = dist2D(lm[2], lm[17]) / tamMao;
  const distPolIndMCP    = dist2D(lm[4], lm[5])  / tamMao;
  const distPolCentroMCP = dist2D(lm[4], lm[9])  / tamMao;
  const distPolAnelarMCP = dist2D(lm[4], lm[13]) / tamMao;
  const larguraPalma     = dist2D(lm[5], lm[17]) / tamMao;
  const P = distPolMind > distBaseMind * 1.18 && distPolIndMCP > 0.40;

  // Distâncias normalizadas entre pontos-chave
  const distPI  = dist2D(lm[4], lm[8])  / tamMao;
  const distPM  = dist2D(lm[4], lm[12]) / tamMao;
  const distPA  = dist2D(lm[4], lm[16]) / tamMao;
  const distIM  = dist2D(lm[8], lm[12]) / tamMao;
  const distMA  = dist2D(lm[12], lm[16]) / tamMao;
  const distPIP = dist2D(lm[6], lm[10]) / tamMao;
  const aberturaTotalDedos = dist2D(lm[8], lm[20]) / tamMao;

  // Métricas globais de curvatura conjunta dos 4 dedos (para C, E, O, B)
  const mediaAngPIP = (angPIP_I + angPIP_M + angPIP_A) / 3;
  const mediaAngDIP = (angDIP_I + angDIP_M + angDIP_A) / 3;
  const spreadPIP = Math.max(angPIP_I, angPIP_M, angPIP_A) - Math.min(angPIP_I, angPIP_M, angPIP_A);

  const pontaAcimaMCP_I = (lm[5].y  - lm[8].y)  / tamMao;
  const pontaAcimaMCP_M = (lm[9].y  - lm[12].y) / tamMao;
  const pontaAcimaMCP_A = (lm[13].y - lm[16].y) / tamMao;
  const mediaPontaAcimaMCP = (pontaAcimaMCP_I + pontaAcimaMCP_M + pontaAcimaMCP_A) / 3;

  const distPontasPulso =
    (dist2D(lm[8], lm[0]) + dist2D(lm[12], lm[0]) + dist2D(lm[16], lm[0])) / (3 * tamMao);
  const mediaPontasY = (lm[8].y + lm[12].y + lm[16].y) / 3;
  const polegarAbaixoDasPontas = (lm[4].y - mediaPontasY) / tamMao;

  // ── 0. FILTRO DE POSTURA NEUTRA / PALMA ABERTA EM REPOUSO vs LETRA 'B' ──
  // Quando os 4 dedos estão levantados/abertos (I && M && A && Mi, ou semi-abertos voltados para cima):
  //  - Na letra 'B', os 4 dedos precisam estar UNIDOS (fechados entre si) E o polegar precisa estar
  //    DOBRADO DENTRO DA PALMA (cruzado à frente do metacarpo médio/anelar).
  //  - Se o polegar estiver aberto/relaxado na lateral OU os dedos estiverem espalhados (mão aberta / "5"),
  //    o usuário NÃO está fazendo nenhum sinal (estado neutro de repouso).
  const quatroDedosLevantados =
    (I && M && A && Mi) ||
    (angPIP_I > 136 && angPIP_M > 136 && angPIP_A > 136 && angPIP_Mi > 130 && mediaPontaAcimaMCP > 0.36);

  if (quatroDedosLevantados) {
    const polegarDobradoNaPalma =
      !P &&
      distPolMind < distBaseMind * 0.99 &&
      (distPolCentroMCP < 0.45 || distPolAnelarMCP < 0.48) &&
      distPolIndMCP < 0.40;

    const quatroDedosUnidos =
      distIM < 0.23 &&
      distMA < 0.23 &&
      aberturaTotalDedos < 0.80 &&
      mediaAngPIP > 148;

    if (polegarDobradoNaPalma && quatroDedosUnidos) {
      return { letra: 'B', confianca: 0.94 };
    }

    // Palma aberta ou mão relaxada com os 5 dedos soltos -> Nenhum sinal ativo!
    return { letra: null, neutro: true, confianca: 0 };
  }

  // ── DETECÇÃO PRIORITÁRIA DE 'P' (Configuração de K inclinada na horizontal / médio fletido no MCP) ──
  const compIndMCP = dist2D(lm[8], lm[5]) / tamMao;
  const compMedMCP = dist2D(lm[12], lm[9]) / tamMao;
  const compAneMCP = dist2D(lm[16], lm[13]) / tamMao;
  const compMinMCP = dist2D(lm[20], lm[17]) / tamMao;

  const indEstendidoP = angPIP_I > 125 && compIndMCP > 0.50;
  const medEstendidoP = angPIP_M > 108 && compMedMCP > 0.42;
  const aneRecolhidoP = !A && (angPIP_A < 138 || compAneMCP < compIndMCP * 0.78);
  const minRecolhidoP = !Mi && (angPIP_Mi < 138 || compMinMCP < compIndMCP * 0.78);

  if (indEstendidoP && medEstendidoP && aneRecolhidoP && minRecolhidoP) {
    const inclinacaoInd = Math.abs(lm[8].x - lm[5].x) / Math.max(Math.abs(lm[8].y - lm[5].y), 0.01);
    const inclinacaoMao = Math.abs(lm[9].x - lm[0].x) / Math.max(Math.abs(lm[9].y - lm[0].y), 0.01);
    const medioAbaixoIndicador = (lm[12].y - lm[8].y) / tamMao;

    const posturaHorizontalOuFletidaP =
      inclinacaoInd > 0.50 ||
      inclinacaoMao > 0.54 ||
      medioAbaixoIndicador > 0.13 ||
      (!I && angPIP_I > 132) ||
      (!M && angPIP_M > 122 && distIM > 0.18);

    const medioSeparadoDoAnelar =
      angPIP_M - angPIP_A > 16 ||
      distMA > 0.18 ||
      compMedMCP > compAneMCP * 1.18;

    if (posturaHorizontalOuFletidaP && medioSeparadoDoAnelar) {
      return { letra: 'P', confianca: 0.90 };
    }
  }

  // ── DETECÇÃO BIOMECÂNICA DE 'C' (Arco contínuo dos 4 dedos + abertura em C com o polegar) ──
  const quatroDedosAcoplados =
    spreadPIP < 40 &&
    angPIP_I > 88 &&
    angPIP_M > 88 &&
    angPIP_A > 88 &&
    angPIP_Mi > 82 &&
    mediaPontaAcimaMCP < 0.48 &&
    (mediaPontaAcimaMCP > -0.06 || distPontasPulso > 1.04);

  const curvaturaArcoC =
    mediaAngPIP < 146 ||
    mediaAngDIP < 145 ||
    (larguraPalma < 0.68 && mediaAngPIP < 164);

  const aberturaBocaC =
    distPI >= 0.30 &&
    distPI <= 1.15 &&
    distPM >= 0.31 &&
    polegarAbaixoDasPontas > 0.08;

  const polegarEmArcoC =
    P ||
    distPolAnelarMCP >= 0.53 ||
    distPolMind >= 0.74 ||
    larguraPalma < 0.72 ||
    (mediaAngPIP > 110 && mediaPontaAcimaMCP > 0.14 && distPI > 0.38);

  if (quatroDedosAcoplados && curvaturaArcoC && aberturaBocaC && polegarEmArcoC) {
    const naoEhF_ou_W = !(
      (!I && M && A && Mi && angPIP_M > 158 && angPIP_I < 120) ||
      (I && M && A && !Mi && angPIP_I > 158 && angPIP_Mi < 115)
    );
    if (naoEhF_ou_W) {
      return { letra: 'C', confianca: 0.90 };
    }
  }

  // ── CASO 2: Indicador flexionado e Médio + Anelar + Mindinho estendidos (F vs T) ──
  if (!I && M && A && Mi) {
    if (distPI < 0.44 || lm[4].y < lm[6].y) return { letra: 'F', confianca: 0.89 };
    return { letra: 'T', confianca: 0.86 };
  }

  // ── CASO 3: Indicador + Médio + Anelar estendidos, Mindinho recolhido (W) ──
  if (I && M && A && !Mi) {
    return { letra: 'W', confianca: 0.91 };
  }

  // ── CASO 4: Indicador + Médio estendidos, Anelar + Mindinho recolhidos (R, K, V, U) ──
  if (I && M && !A && !Mi) {
    const dirBaseX  = lm[5].x - lm[9].x;
    const dirPontaX = lm[8].x - lm[12].x;
    const cruzados  = dirBaseX * dirPontaX < 0 || distIM < distPIP * 0.72;
    if (cruzados) return { letra: 'R', confianca: 0.88 };
    if (P)        return { letra: 'K', confianca: 0.86 };
    if (distIM > 0.23) return { letra: 'V', confianca: 0.92 };
    return { letra: 'U', confianca: 0.90 };
  }

  // ── CASO 5: Apenas Indicador estendido verticalmente (L, D, G) ──
  if (I && !M && !A && !Mi) {
    if (P)             return { letra: 'L', confianca: 0.94 };
    if (distPM < 0.45) return { letra: 'D', confianca: 0.88 };
    return { letra: 'G', confianca: 0.85 };
  }

  // ── CASO 6: Apenas Mindinho estendido (Y vs I) ──
  if (!I && !M && !A && Mi) {
    if (P) return { letra: 'Y', confianca: 0.93 };
    return { letra: 'I', confianca: 0.91 };
  }

  // ── CASO 7: Todos os 4 dedos sem extensão vertical completa (X, O, C, E, S, A) ──
  if (!I && !M && !A && !Mi) {
    // 7.1 Letra X: Indicador elevado em gancho enquanto Médio, Anelar e Mindinho estão fechados
    const indAcimaMed = (lm[12].y - lm[8].y) / tamMao;
    const pipIndAcimaMed = (lm[10].y - lm[6].y) / tamMao;
    if (
      indAcimaMed > 0.22 &&
      pipIndAcimaMed > 0.16 &&
      lm[6].y < lm[5].y - tamMao * 0.14 &&
      angPIP_I < 142 &&
      lm[12].y > lm[9].y
    ) {
      return { letra: 'X', confianca: 0.86 };
    }

    // 7.2 Letra O: Pontas do indicador e médio unidas em pinça direta com a ponta do polegar
    if (distPI < 0.29 && distPM < 0.34 && distPA < 0.44) {
      return { letra: 'O', confianca: 0.89 };
    }

    // 7.3 Análise Biomecânica de Garra (E / C) vs Punho Fechado (A / S)
    const pipElevI  = (lm[5].y  - lm[6].y)  / tamMao;
    const pipElevM  = (lm[9].y  - lm[10].y) / tamMao;
    const pipElevA  = (lm[13].y - lm[14].y) / tamMao;
    const mediaPipElev = (pipElevI + pipElevM + pipElevA) / 3;

    const falangesEmGarra =
      mediaPipElev > 0.10 &&
      (mediaPontaAcimaMCP > -0.14 || distPontasPulso > 1.00) &&
      (mediaAngPIP < 154 || mediaAngDIP < 156);

    if (falangesEmGarra) {
      // Diferencia C vs E dentro do Caso 7:
      if (
        distPI >= 0.30 &&
        mediaAngPIP > 92 &&
        (P || distPolAnelarMCP >= 0.52 || distPolMind >= 0.74 || larguraPalma < 0.73)
      ) {
        return { letra: 'C', confianca: 0.89 };
      }
      return { letra: 'E', confianca: 0.91 };
    }

    // Caso adicional para 'E': pontas claramente acima do polegar recolhido na palma
    if (
      polegarAbaixoDasPontas > 0.08 &&
      distPontasPulso > 0.96 &&
      mediaPipElev > 0.06 &&
      distPI > 0.25
    ) {
      return { letra: 'E', confianca: 0.88 };
    }

    // 7.4 Punho Fechado: Diferenciação entre A e S
    const distPolMedioPIP = dist2D(lm[4], lm[10]) / tamMao;
    const distPolAnelarPIP = dist2D(lm[4], lm[14]) / tamMao;

    if (distPolMedioPIP < 0.37 || distPolAnelarPIP < 0.42) {
      return { letra: 'S', confianca: 0.88 };
    }

    return { letra: 'A', confianca: 0.91 };
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

const smoother = new LandmarkSmoother(0.55);
const stabilityBuffer = new GestureStabilityBuffer(850);

function toggleCamera() {
  if (cameraAtiva) pararCamera();
  else ligarCamera();
}

function ehDispositivoMovelCamera() {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    Boolean(window.matchMedia && window.matchMedia('(max-width: 980px) and (pointer: coarse)').matches)
  );
}

function ajustarContainerCameraOrientacao(video) {
  const wrap = document.getElementById('camera-wrap');
  if (!wrap) return;

  if (!ehDispositivoMovelCamera()) {
    wrap.style.removeProperty('aspect-ratio');
    return;
  }

  const vw = video?.videoWidth || 0;
  const vh = video?.videoHeight || 0;
  if (vw > 0 && vh > 0) {
    wrap.style.aspectRatio = `${vw} / ${vh}`;
  } else {
    const emRetrato = window.innerHeight >= window.innerWidth;
    wrap.style.aspectRatio = emRetrato ? '3 / 4' : '16 / 9';
  }
}

async function ligarCamera() {
  const btn = document.getElementById('btn-toggle-camera');
  if (btn) {
    btn.textContent = '⏳ Aguardando permissão...';
    btn.disabled = true;
  }

  const errEl = document.getElementById('camera-erro');
  if (errEl) errEl.style.display = 'none';

  const ehMobile = ehDispositivoMovelCamera();
  // Em dispositivos móveis, não força width/height fixos em paisagem para que o sensor
  // entregue retrato (vertical) quando o celular está em pé e paisagem quando deitado.
  const constraints = ehMobile
    ? [
        { facingMode: 'user' },
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
  video.onloadedmetadata = () => ajustarContainerCameraOrientacao(video);
  video.onresize = () => ajustarContainerCameraOrientacao(video);
  video.srcObject = cameraStream;
  await video.play();
  ajustarContainerCameraOrientacao(video);

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
  if (typeof Hands !== 'undefined') {
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
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    if (camCanvas.width !== vw || camCanvas.height !== vh) {
      camCanvas.width = vw;
      camCanvas.height = vh;
      ajustarContainerCameraOrientacao(video);
    }

    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
      const lmSuavizado = smoother.smooth(res.multiHandLandmarks[0]);
      stabilityBuffer.registrarPontosTrajetoria(lmSuavizado);
      desenharLandmarks(camCtx, lmSuavizado, camCanvas.width, camCanvas.height);
      processarLandmarks(lmSuavizado);
    } else {
      smoother.reset();
      const status = stabilityBuffer.processarPredicao(null);
      atualizarResultadoCamera(status.letra, status.confianca, status.estabilidadePct, status.emCooldown);
    }
  });

  // Loop de envio direto a partir do stream nativo (preserva orientação retrato/paisagem no mobile!)
  const loopInferencia = async () => {
    if (!cameraAtiva || !mpHands) return;
    camRafId = requestAnimationFrame(loopInferencia);

    if (document.hidden || processandoFrame || video.readyState < 2) return;
    processandoFrame = true;
    try {
      await mpHands.send({ image: video });
    } catch (_) {}
    processandoFrame = false;
  };

  camRafId = requestAnimationFrame(loopInferencia);
  log('✓ Visão IA ativa — sustentação de 0.85s + trajetória dinâmica J/Z', 'success');
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

  // Desenha trilha espacial luminosa ao traçar J ou Z na câmera
  const trilhaAtiva = stabilityBuffer.obterTrilhaAtivaVisual();
  if (trilhaAtiva && trilhaAtiva.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(trilhaAtiva[0].x * w, trilhaAtiva[0].y * h);
    for (let i = 1; i < trilhaAtiva.length; i++) {
      ctx.lineTo(trilhaAtiva[i].x * w, trilhaAtiva[i].y * h);
    }
    ctx.strokeStyle = 'rgba(245, 245, 247, 0.72)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(148, 184, 200, 0.85)';
  ctx.lineWidth = 2.0;
  ctx.shadowColor = 'rgba(148, 184, 200, 0.25)';
  ctx.shadowBlur = 4;

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
    ctx.arc(pt.x * w, pt.y * h, isPalma ? 6.5 : isPonta ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isPonta ? '#f5f5f7' : isPalma ? '#ffffff' : '#94b8c8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 5, 5, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  ctx.restore();
}

function processarLandmarks(lm) {
  const predicaoBruta = reconhecerConfiguracao(lm);
  const status = stabilityBuffer.processarPredicao(predicaoBruta);

  atualizarResultadoCamera(
    status.letra,
    status.confianca,
    status.estabilidadePct,
    status.emCooldown,
    status.neutro
  );

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

function atualizarResultadoCamera(
  letra,
  confianca,
  estabilidadePct,
  emCooldown = false,
  neutro = false
) {
  const elLetra = document.getElementById('letra-camera-detectada');
  if (elLetra) elLetra.textContent = letra || '—';

  const pctConf = letra ? Math.round(confianca * 100) : 0;
  const elConf = document.getElementById('lbl-confianca');
  if (elConf) {
    if (emCooldown && letra) {
      elConf.textContent = `✓ Letra ${letra} confirmada · Pronta para próximo gesto`;
    } else if (letra) {
      const segRestante = ((1 - (estabilidadePct || 0) / 100) * 0.85).toFixed(2);
      elConf.textContent =
        estabilidadePct >= 100
          ? `Confiança: ${pctConf}% · Confirmada`
          : `Confiança: ${pctConf}% · Sustentação: ${estabilidadePct || 0}% (${segRestante}s)`;
    } else if (neutro) {
      elConf.textContent = '✋ Mão em repouso (palma aberta) · Nenhum sinal ativo';
    } else {
      elConf.textContent = 'Aguardando gesto estável (0.85s) ou traçado J / Z...';
    }
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
      camCtx.fillStyle = 'rgba(148, 184, 200, 0.65)';
      ctx.fill?.() || camCtx.fill();
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

function removerAcentosAscii(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectarPalavraChaveExata(texto) {
  const t = removerAcentosAscii(texto).trim().toUpperCase();
  return PALAVRAS_CHAVE.find((pk) => pk === t) || null;
}

function tokenizarTextoLibras(texto) {
  const limpo = removerAcentosAscii(texto).trim().replace(/\s+/g, ' ').toUpperCase();
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
  const targetId =
    AppState.telaAtual === 'home'
      ? 'home-hand3d-container'
      : AppState.telaAtual === 'text'
      ? 'hand3d-container'
      : null;

  if (!targetId) return;
  if (typeof THREE === 'undefined') {
    log('⚠ Three.js não carregado — verifique sua conexão', 'error');
    return;
  }

  const isTextScreen = targetId === 'hand3d-container';

  if (libraHand3D && libraHand3D.pronto && libraHand3D.containerId === targetId) {
    if (isTextScreen) {
      libraHand3D.autoRotando = false;
      const btn = document.getElementById('btn-3d-rotacionar');
      if (btn) {
        btn.textContent = '▶ Rotação';
        btn.classList.remove('ativo');
      }
    }
    libraHand3D._resize();
    return;
  }

  if (libraHand3D) {
    libraHand3D.destruir();
    libraHand3D = null;
  }

  libraHand3D = new LibraHand3D(targetId);
  libraHand3D.setUp();

  // Na aba de Tradução por Texto, a rotação vem desativada por padrão; na Home vem ativada
  if (isTextScreen) {
    libraHand3D.autoRotando = false;
    const btn = document.getElementById('btn-3d-rotacionar');
    if (btn) {
      btn.textContent = '▶ Rotação';
      btn.classList.remove('ativo');
    }
  } else {
    libraHand3D.autoRotando = true;
    const btnHome = document.getElementById('btn-home-3d-rotacionar');
    if (btnHome) {
      btnHome.textContent = '⏸ Rotação Orbital';
      btnHome.classList.add('ativo');
    }
  }

  const loadingId = targetId === 'home-hand3d-container' ? 'home-hand3d-loading' : 'hand3d-loading';
  if (window.removerLoading3D) window.removerLoading3D(loadingId);
  log('✓ Mão biônica 3D inicializada', 'success');
}

function toggle3DRotacao() {
  if (!libraHand3D) return;
  const ativo = libraHand3D.toggleRotacao();
  const btn = document.getElementById('btn-3d-rotacionar');
  if (btn) {
    btn.textContent = ativo ? '⏸ Rotação' : '▶ Rotação';
    btn.classList.toggle('ativo', ativo);
  }
  const btnHome = document.getElementById('btn-home-3d-rotacionar');
  if (btnHome) {
    btnHome.textContent = ativo ? '⏸ Rotação Orbital' : '▶ Rotação Orbital';
    btnHome.classList.toggle('ativo', ativo);
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
  const btnHome = document.getElementById('btn-home-3d-rotacionar');
  if (btnHome) {
    btnHome.textContent = '▶ Rotação Orbital';
    btnHome.classList.remove('ativo');
  }
}

function visualizarPoseLabHome(letra) {
  const dados = buscarLetra(letra);
  if (!dados) return;

  document.querySelectorAll('.btn-pose-demo').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-home-letra') === letra);
  });

  const badgeEl = document.getElementById('home-letra-atual');
  if (badgeEl) badgeEl.textContent = `SINAL · ${letra}`;

  const descEl = document.getElementById('home-feedback-modo');
  if (descEl) descEl.textContent = dados.descricao || `Configuração articular da letra ${letra}`;

  if (libraHand3D && libraHand3D.pronto && dados.rotacoes3d) {
    libraHand3D.animarLetra(dados.rotacoes3d, dados.movimento, dados.pontaRastro);
  }

  if (btManager.conectado && dados.comando) {
    btManager.enviar(dados.comando);
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

  // Pronuncia a frase completa de forma natural em pt-BR (ou a letra se for apenas 1 caractere)
  const ehLetraUnica = tokensVisiveis.length === 1 && tokensVisiveis[0].tipo === 'letra';
  if (ehLetraUnica) {
    SpeechService.falar(tokensVisiveis[0].valor);
  } else {
    SpeechService.falarTextoLivre(texto);
  }

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

      if (btManager.conectado && cmd) {
        btManager.enviar(cmd);
        log(`↗ ${letra} → ${cmd}`, 'success');
      } else {
        log(`◌ ${letra}${cmd ? ` → ${cmd}` : ''}`, 'info');
      }

      // Letras com trajetória espacial (J, Z) recebem tempo para preparação da pose + traçado completo + sustentação
      const durBase =
        dados?.movimento === 'tracar_z'
          ? 2450
          : dados?.movimento === 'tracar_j'
          ? 2200
          : 520;
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
function selecionarAbaTexto(abaId) {
  if (!abaId) return;
  document.querySelectorAll('.text-tab-btn').forEach((btn) => {
    const ativa = btn.getAttribute('data-text-tab') === abaId;
    btn.classList.toggle('active', ativa);
    btn.setAttribute('aria-selected', ativa ? 'true' : 'false');
  });
  document.querySelectorAll('.text-tab-pane').forEach((pane) => {
    const ativa = pane.getAttribute('data-tab-pane') === abaId;
    pane.classList.toggle('active', ativa);
  });
}

function mostrarTela(id) {
  pararTraducaoAtiva();
  AppState.telaAtual = id;

  document.querySelectorAll('.screen').forEach((t) => t.classList.remove('active'));

  const tela = document.getElementById(`screen-${id}`);
  if (tela) tela.classList.add('active');

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (id === 'text' || id === 'home') {
    timers.schedule(inicializar3D, 100);
  } else if (libraHand3D) {
    libraHand3D.destruir();
    libraHand3D = null;
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
  SpeechService.init();
  carregarBanco();
  popularTecladoAZ();
  mostrarTela('home');

  // ── NAVEGAÇÃO HOME (Unificada na Tradução por Texto) ──
  document.getElementById('btn-ir-texto')?.addEventListener('click', () => mostrarTela('text'));
  document.getElementById('btn-ir-camera')?.addEventListener('click', () => mostrarTela('camera'));
  document.getElementById('btn-ir-teclado')?.addEventListener('click', () => mostrarTela('text'));
  document.getElementById('btn-ir-bluetooth')?.addEventListener('click', () => {
    mostrarTela('text');
    selecionarAbaTexto('calibracao');
  });

  // Botões de status Bluetooth no topo da Home e da Câmera
  document.getElementById('btn-home-top-bt')?.addEventListener('click', () => {
    if (window.tecladoDatilografo) window.tecladoDatilografo.alternarConexaoBT();
    else btManager.conectar();
  });
  document.getElementById('btn-cam-top-bt')?.addEventListener('click', () => {
    if (window.tecladoDatilografo) window.tecladoDatilografo.alternarConexaoBT();
    else btManager.conectar();
  });

  // ── CONTROLES DO LABORATÓRIO 3D NA HOME ──
  document.getElementById('btn-home-3d-rotacionar')?.addEventListener('click', toggle3DRotacao);
  document.getElementById('btn-home-3d-resetar')?.addEventListener('click', resetar3DCamera);

  document.getElementById('btn-home-3d-neutra')?.addEventListener('click', () => {
    if (libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      document.querySelectorAll('.btn-pose-demo').forEach((b) => b.classList.remove('active'));
      const badgeEl = document.getElementById('home-letra-atual');
      if (badgeEl) badgeEl.textContent = 'POSE NEUTRA';
      const descEl = document.getElementById('home-feedback-modo');
      if (descEl) descEl.textContent = 'Arraste na cena para rodar · Scroll para zoom';
    }
    if (window.tecladoDatilografo) window.tecladoDatilografo.aplicarRepouso(true);
  });

  document.querySelectorAll('.btn-pose-demo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const letra = btn.getAttribute('data-home-letra');
      if (letra) visualizarPoseLabHome(letra);
    });
  });

  // ── BOTÕES DE VOLTAR ──
  document.querySelectorAll('.btn-back').forEach((btn) => {
    btn.addEventListener('click', () => {
      pararTraducaoAtiva();
      pararCamera();
      mostrarTela('home');
    });
  });

  // ── ABAS COMPACTAS (TELA TEXTO) ──
  document.querySelectorAll('.text-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const aba = btn.getAttribute('data-text-tab');
      if (aba) selecionarAbaTexto(aba);
    });
  });

  // ── TELA TEXTO, TECLADO DATILÓGRAFO & 3D ──
  document.getElementById('btn-traduzir')?.addEventListener('click', iniciarTraducao);
  document.getElementById('btn-limpar')?.addEventListener('click', () => {
    limparCampo();
    if (window.tecladoDatilografo) window.tecladoDatilografo.aplicarRepouso(true);
  });

  const btnVoz = document.getElementById('btn-toggle-voz');
  if (btnVoz) {
    btnVoz.textContent = AppState.vozAtiva ? '🔊 Voz: ON' : '🔇 Voz: OFF';
    btnVoz.classList.toggle('muted', !AppState.vozAtiva);
    btnVoz.setAttribute('aria-pressed', AppState.vozAtiva ? 'true' : 'false');

    btnVoz.addEventListener('click', () => {
      AppState.vozAtiva = !AppState.vozAtiva;
      btnVoz.textContent = AppState.vozAtiva ? '🔊 Voz: ON' : '🔇 Voz: OFF';
      btnVoz.classList.toggle('muted', !AppState.vozAtiva);
      btnVoz.setAttribute('aria-pressed', AppState.vozAtiva ? 'true' : 'false');
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
  let valorAnteriorInput = '';
  if (inputTexto) {
    inputTexto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        iniciarTraducao();
      }
    });

    // Sincronização em tempo real ao digitar no campo: anima a mão 3D e move a mão física ESP32 imediatamente!
    inputTexto.addEventListener('input', function () {
      const pos = this.selectionStart;
      const limpo = this.value
        .toUpperCase()
        .replace(/[^A-Z\u00C0-\u00DD \n]/g, '');
      if (this.value !== limpo) {
        this.value = limpo;
        try {
          this.setSelectionRange(pos, pos);
        } catch (_) {}
      }

      if (this.value.length > valorAnteriorInput.length) {
        const ultimoChar = removerAcentosAscii(this.value.slice(-1)).toUpperCase();
        if (/^[A-Z]$/.test(ultimoChar)) {
          if (AppState.traduzindo) pararTraducaoAtiva();
          if (window.tecladoDatilografo) {
            const btnKey = document.querySelector(`#teclado-botoes-grid .key-btn[data-letra="${ultimoChar}"]`);
            if (btnKey) window.tecladoDatilografo._animarBotao(btnKey);
            window.tecladoDatilografo._tocarCliqueSom();
            window.tecladoDatilografo.selecionarLetra(ultimoChar, true);
          } else {
            visualizarLetraUnica3D(ultimoChar);
          }
        } else if (ultimoChar === ' ') {
          if (window.tecladoDatilografo) {
            window.tecladoDatilografo.aplicarRepouso(true);
          }
        }
      } else if (this.value.length === 0) {
        if (window.tecladoDatilografo) {
          window.tecladoDatilografo.aplicarRepouso(true);
        }
      }
      valorAnteriorInput = this.value;
    });
  }

  // ── CONTROLES 3D (TELA TEXTO) ──
  document.getElementById('btn-3d-rotacionar')?.addEventListener('click', toggle3DRotacao);
  document.getElementById('btn-3d-resetar')?.addEventListener('click', resetar3DCamera);

  document.getElementById('btn-3d-neutra')?.addEventListener('click', () => {
    if (libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      setLetraAtual('✋');
      setFeedbackModo('Posição neutra / repouso (90°)');
    }
    if (window.tecladoDatilografo) {
      window.tecladoDatilografo.aplicarRepouso(true);
    }
  });

  // ── SINAIS RÁPIDOS ──
  document.querySelectorAll('.btn-palavra').forEach((btn) => {
    btn.addEventListener('click', () => {
      const palavra = btn.getAttribute('data-p');
      if (inputTexto) {
        inputTexto.value = palavra;
        valorAnteriorInput = palavra;
      }
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
      SpeechService.falarTextoLivre(el.textContent.trim(), { forcar: true });
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

  const aoMudarOrientacaoCamera = () => {
    if (!cameraAtiva) return;
    const v = document.getElementById('cameraVideo');
    setTimeout(() => ajustarContainerCameraOrientacao(v), 120);
  };
  window.addEventListener('orientationchange', aoMudarOrientacaoCamera, { passive: true });
  window.addEventListener('resize', aoMudarOrientacaoCamera, { passive: true });

  // ── BOTÕES BLUETOOTH NA ABA DE CALIBRAÇÃO ──
  document.getElementById('btn-bt-conectar')?.addEventListener('click', () => btManager.conectar());
  document.getElementById('btn-bt-desconectar')?.addEventListener('click', () => btManager.desconectar());
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
    J: { c: 'CMD_J', m: 'tracar_j', p: 'mindinho', d: 'Dedo mínimo traçando a curva fluida do J no ar', r: { pulso: { x: 0.04, y: -0.10, z: 0 }, polegar: { x: 0.72, y: -0.22, z: 0.16, midX: 0.68 }, indicador: { x: 1.62, y: 0, z: 0.03, midX: 1.68, distX: 1.30 }, medio: { x: 1.62, y: 0, z: 0, midX: 1.68, distX: 1.30 }, anelar: { x: 1.62, y: 0, z: -0.03, midX: 1.68, distX: 1.30 }, mindinho: { x: 0.02, y: 0, z: -0.02, midX: 0.02, distX: 0.02 } } },
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

// ============================================================
// 13. MÓDULO CONTROLADOR UNIFICADO: TECLADO DATILÓGRAFO & 6 SERVOS ESP32 (v10.0)
// ============================================================
class TecladoDatilografoController {
  constructor() {
    this.audioCtx = null;
    this.letraSelecionadaAtual = 'A';
    this.throttleTimer = null;
    this.init();
  }

  init() {
    this._registrarTeclasVirtuais();
    this._registrarTecladoFisico();
    this._registrarControlesFrase();
    this._registrarSlidersCalibracao();
    this._registrarConexaoBluetooth();
    this._sincronizarEventosBT();

    this.sincronizarLetraUI('A', false);
  }

  _tocarCliqueSom() {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, this.audioCtx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.04);
    } catch (_) {}
  }

  _registrarSlidersCalibracao() {
    const nomes = ['polegar', 'indicador', 'medio', 'anelar', 'mindinho', 'pulso'];
    nomes.forEach((nome) => {
      const slider = document.getElementById(`slider-servo-${nome}`);
      if (!slider) return;

      slider.addEventListener('input', () => {
        const val = Math.max(90, Math.min(180, Number(slider.value)));
        this._atualizarGauge(nome, val, false);
        this._enviarSlidersAtuaisDebounced();
      });
    });

    document.getElementById('btn-salvar-pose-letra')?.addEventListener('click', () => {
      const angulos = this._lerSlidersAtuais();
      if (window.libratronicBT && this.letraSelecionadaAtual && this.letraSelecionadaAtual !== 'REPOUSO') {
        window.libratronicBT.salvarPoseLetra(this.letraSelecionadaAtual, angulos);
        mostrarNotificacaoUI(`✓ Novos graus salvos para a Letra ${this.letraSelecionadaAtual}!`, 'success');
        this.selecionarLetra(this.letraSelecionadaAtual, true);
      }
    });

    document.getElementById('btn-fixar-pulso-neutro')?.addEventListener('click', () => {
      const angulos = this._lerSlidersAtuais();
      if (window.libratronicBT) {
        const novoPulso = window.libratronicBT.setPulsoNeutro(angulos.pulso);
        mostrarNotificacaoUI(`✓ Pulso neutro fixado em ${novoPulso}° para Repouso e letras!`, 'success');
        this.aplicarRepouso(true);
      }
    });

    document.getElementById('btn-inverter-pol-ind')?.addEventListener('click', (e) => {
      if (window.libratronicBT) {
        window.libratronicBT.inverterPolInd = !window.libratronicBT.inverterPolInd;
        const ativo = window.libratronicBT.inverterPolInd;
        e.currentTarget.style.borderColor = ativo ? '#7ec8a0' : '';
        e.currentTarget.style.color = ativo ? '#7ec8a0' : '';
        mostrarNotificacaoUI(
          ativo ? '⇄ Inversão Polegar ↔ Indicador ATIVADA via site!' : '⇄ Ordem padrão Polegar (12) / Indicador (13) restaurada.',
          'info'
        );
        this._enviarSlidersAtuaisDebounced();
      }
    });

    document.getElementById('select-pino-medio')?.addEventListener('change', (e) => {
      const novoPino = Number(e.target.value);
      if (window.libratronicBT && novoPino) {
        window.libratronicBT.alterarPinoServo(3, novoPino);
        mostrarNotificacaoUI(`Pino do Dedo Médio alterado para GPIO ${novoPino}. Movendo para testar...`, 'info');
        setTimeout(() => this._enviarSlidersAtuaisDebounced(), 120);
      }
    });

    document.getElementById('btn-resetar-calibracao')?.addEventListener('click', () => {
      if (window.libratronicBT) {
        window.libratronicBT.resetarCalibracaoPadrao();
      }
    });
  }

  _lerSlidersAtuais() {
    const ler = (nome) => {
      const el = document.getElementById(`slider-servo-${nome}`);
      return el ? Math.max(90, Math.min(180, Number(el.value))) : 90;
    };
    return {
      polegar: ler('polegar'),
      indicador: ler('indicador'),
      medio: ler('medio'),
      anelar: ler('anelar'),
      mindinho: ler('mindinho'),
      pulso: ler('pulso')
    };
  }

  _enviarSlidersAtuaisDebounced() {
    const s = this._lerSlidersAtuais();
    const elCmd = document.getElementById('teclado-comando-codigo');
    if (elCmd) {
      elCmd.textContent = `<ANG:${s.polegar},${s.indicador},${s.medio},${s.anelar},${s.mindinho},${s.pulso}>`;
    }

    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.throttleTimer = setTimeout(() => {
      if (window.libratronicBT && window.libratronicBT.conectado) {
        window.libratronicBT.enviarAngulos(s.polegar, s.indicador, s.medio, s.anelar, s.mindinho, s.pulso);
      }
    }, 45);
  }

  _registrarTeclasVirtuais() {
    const botoes = document.querySelectorAll('#teclado-botoes-grid .key-btn[data-letra]');
    botoes.forEach(btn => {
      const letra = btn.dataset.letra;
      btn.addEventListener('click', () => {
        if (AppState.traduzindo) pararTraducaoAtiva();
        this._tocarCliqueSom();
        this._animarBotao(btn);
        this.selecionarLetra(letra, true);

        const input = document.getElementById('input-texto');
        if (input) input.value += letra;
      });
    });

    document.getElementById('btn-teclado-space')?.addEventListener('click', (e) => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      this._tocarCliqueSom();
      this._animarBotao(e.currentTarget);
      this.aplicarRepouso(true);
      const input = document.getElementById('input-texto');
      if (input) input.value += ' ';
    });

    document.getElementById('btn-teclado-backspace')?.addEventListener('click', (e) => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      this._tocarCliqueSom();
      this._animarBotao(e.currentTarget);
      const input = document.getElementById('input-texto');
      if (input && input.value.length > 0) {
        input.value = input.value.slice(0, -1);
        const ultimo = removerAcentosAscii(input.value.slice(-1)).toUpperCase();
        if (/^[A-Z]$/.test(ultimo)) {
          this.selecionarLetra(ultimo, true);
        } else {
          this.aplicarRepouso(true);
        }
      } else {
        this.aplicarRepouso(true);
      }
    });

    document.getElementById('btn-teclado-modo-neutro')?.addEventListener('click', (e) => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      this._tocarCliqueSom();
      this._animarBotao(e.currentTarget);
      this.aplicarRepouso(true);
    });

    document.getElementById('btn-teclado-status-bt-key')?.addEventListener('click', () => {
      this.alternarConexaoBT();
    });
  }

  _animarBotao(btn) {
    if (!btn) return;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 140);
  }

  _registrarTecladoFisico() {
    window.addEventListener('keydown', (e) => {
      if (AppState.telaAtual !== 'text') return;
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key.toUpperCase();
      if (/^[A-Z]$/.test(key)) {
        e.preventDefault();
        if (AppState.traduzindo) pararTraducaoAtiva();
        const btn = document.querySelector(`#teclado-botoes-grid .key-btn[data-letra="${key}"]`);
        if (btn) this._animarBotao(btn);
        this._tocarCliqueSom();
        this.selecionarLetra(key, true);

        const input = document.getElementById('input-texto');
        if (input) input.value += key;
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (AppState.traduzindo) pararTraducaoAtiva();
        const btn = document.getElementById('btn-teclado-space');
        if (btn) this._animarBotao(btn);
        this._tocarCliqueSom();
        this.aplicarRepouso(true);
        const input = document.getElementById('input-texto');
        if (input) input.value += ' ';
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (AppState.traduzindo) pararTraducaoAtiva();
        const btn = document.getElementById('btn-teclado-backspace');
        if (btn) this._animarBotao(btn);
        this._tocarCliqueSom();
        const input = document.getElementById('input-texto');
        if (input && input.value.length > 0) {
          input.value = input.value.slice(0, -1);
          const ultimo = removerAcentosAscii(input.value.slice(-1)).toUpperCase();
          if (/^[A-Z]$/.test(ultimo)) {
            this.selecionarLetra(ultimo, true);
          } else {
            this.aplicarRepouso(true);
          }
        }
      }
    });
  }

  _registrarControlesFrase() {
    document.getElementById('btn-teclado-repouso')?.addEventListener('click', () => {
      if (AppState.traduzindo) pararTraducaoAtiva();
      this.aplicarRepouso(true);
    });
  }

  _registrarConexaoBluetooth() {
    document.getElementById('btn-teclado-conectar-bt')?.addEventListener('click', () => {
      this.alternarConexaoBT();
    });
  }

  alternarConexaoBT() {
    if (window.libratronicBT && window.libratronicBT.conectado) {
      window.libratronicBT.desconectar();
    } else if (window.libratronicBT) {
      window.libratronicBT.conectar();
    } else {
      btManager.conectar();
    }
  }

  _sincronizarEventosBT() {
    if (!window.libratronicBT) return;

    window.libratronicBT.on('status', ({ estado, mensagem, dispositivo }) => {
      this._atualizarUIStatusBT(estado, mensagem, dispositivo);
      btManager.atualizarUI(estado, dispositivo || mensagem);
    });

    window.libratronicBT.on('conectado', ({ nome }) => {
      mostrarNotificacaoUI(`✓ Conectado ao ESP32 (${nome})`, 'success');
      log(`✓ Web Bluetooth conectado ao ESP32: ${nome}`, 'success');
      btManager.atualizarUI('connected', nome);
    });

    window.libratronicBT.on('desconectado', () => {
      btManager.atualizarUI('disconnected', 'Conectar ESP32');
    });
  }

  _atualizarUIStatusBT(estado, texto, dispositivo) {
    const labelTopo = document.getElementById('teclado-bt-status-label');
    const btnTopo = document.getElementById('btn-teclado-conectar-bt');
    const dotTopo = btnTopo?.querySelector('.bt-dot');
    const labelKey = document.querySelector('#btn-teclado-status-bt-key .key-bt-text');
    const dotKey = document.querySelector('#btn-teclado-status-bt-key .bt-dot');

    const isConnected = estado === 'conectado' || estado === 'connected';
    const isConnecting = estado === 'conectando' || estado === 'connecting';

    if (labelTopo) {
      labelTopo.textContent = isConnected ? (dispositivo || 'ESP32 Online') : (isConnecting ? 'Conectando...' : 'Conectar ESP32');
    }
    if (labelKey) {
      labelKey.textContent = isConnected ? 'ESP32 Online' : (isConnecting ? 'Buscando...' : 'Conectar BLE');
    }

    [dotTopo, dotKey].forEach(dot => {
      if (dot) {
        dot.className = 'bt-dot' + (isConnected ? ' connected' : '') + (isConnecting ? ' connecting' : '');
      }
    });
  }

  sincronizarLetraUI(letra, enviarBLE = true) {
    letra = String(letra).trim().toUpperCase();
    this.letraSelecionadaAtual = letra;
    const tabela = window.LibraTronicBluetooth ? window.LibraTronicBluetooth.getTabelaLetras() : null;
    const info = tabela ? tabela[letra] : null;
    if (!info) return;

    const { polegar, indicador, medio, anelar, mindinho, pulso } = info.servos;

    const elChar = document.getElementById('teclado-letra-ativa');
    const elNome = document.getElementById('teclado-letra-nome');
    const elDesc = document.getElementById('teclado-letra-desc');
    const elCmd  = document.getElementById('teclado-comando-codigo');

    if (elChar) {
      elChar.textContent = letra;
      elChar.classList.remove('pop');
      void elChar.offsetWidth;
      elChar.classList.add('pop');
    }
    if (elNome) elNome.textContent = `Letra ${letra}`;
    if (elDesc) elDesc.textContent = info.descricao;
    if (elCmd) elCmd.textContent = `<L:${letra}:${polegar},${indicador},${medio},${anelar},${mindinho},${pulso}>`;

    document.querySelectorAll('#teclado-botoes-grid .key-btn[data-letra]').forEach((b) => {
      b.classList.toggle('active-key', b.dataset.letra === letra);
    });

    this._atualizarGauge('polegar', polegar);
    this._atualizarGauge('indicador', indicador);
    this._atualizarGauge('medio', medio);
    this._atualizarGauge('anelar', anelar);
    this._atualizarGauge('mindinho', mindinho);
    this._atualizarGauge('pulso', pulso);

    if (enviarBLE && window.libratronicBT) {
      window.libratronicBT.enviarLetra(letra);
      log(`BLE -> ESP32: Letra ${letra} [${polegar}°, ${indicador}°, ${medio}°, ${anelar}°, ${mindinho}°, Pulso:${pulso}°]`, 'info');
    }
  }

  selecionarLetra(letra, enviarBLE = true) {
    letra = String(letra).trim().toUpperCase();
    this.sincronizarLetraUI(letra, enviarBLE);

    const dadosDb = buscarLetra(letra);
    setLetraAtual(letra);
    setFeedbackModo(dadosDb?.descricao || `Letra ${letra} em Libras`);

    if (libraHand3D && libraHand3D.pronto && dadosDb?.rotacoes3d) {
      libraHand3D._ativarUmaMao();
      libraHand3D.animarLetra(dadosDb.rotacoes3d, dadosDb.movimento, dadosDb.pontaRastro);
    }
    SpeechService.falar(letra);
  }

  aplicarRepouso(enviarBLE = true) {
    this.letraSelecionadaAtual = 'REPOUSO';
    const pulsoNeutro = window.libratronicBT ? window.libratronicBT.getPulsoNeutro() : 150;

    const elChar = document.getElementById('teclado-letra-ativa');
    const elNome = document.getElementById('teclado-letra-nome');
    const elDesc = document.getElementById('teclado-letra-desc');
    const elCmd  = document.getElementById('teclado-comando-codigo');

    if (elChar) elChar.textContent = '✋';
    if (elNome) elNome.textContent = 'Posição Neutra / Repouso';
    if (elDesc) elDesc.textContent = `Mão aberta com todos os 5 dedos retos em 90° e pulso alinhado em ${pulsoNeutro}°.`;
    if (elCmd)  elCmd.textContent = `<ANG:90,90,90,90,90,${pulsoNeutro}>`;

    document.querySelectorAll('#teclado-botoes-grid .key-btn[data-letra]').forEach((b) => {
      b.classList.remove('active-key');
    });

    this._atualizarGauge('polegar', 90);
    this._atualizarGauge('indicador', 90);
    this._atualizarGauge('medio', 90);
    this._atualizarGauge('anelar', 90);
    this._atualizarGauge('mindinho', 90);
    this._atualizarGauge('pulso', pulsoNeutro);

    if (libraHand3D && libraHand3D.pronto) {
      libraHand3D._ativarUmaMao();
      libraHand3D.posicaoNeutra();
      setLetraAtual('✋');
      setFeedbackModo(`Mão em repouso (Dedos 90° · Pulso ${pulsoNeutro}°)`);
    }

    if (enviarBLE && window.libratronicBT) {
      window.libratronicBT.enviarRepouso();
    }
  }

  _atualizarGauge(nome, angulo, atualizarSlider = true) {
    const angSeguro = Math.max(90, Math.min(180, Math.round(Number(angulo))));
    const pct = Math.round(((angSeguro - 90) / 90) * 100);

    const valEl = document.getElementById(`val-servo-${nome}`);
    const fillEl = document.getElementById(`fill-servo-${nome}`);
    const sliderEl = document.getElementById(`slider-servo-${nome}`);

    if (valEl) valEl.textContent = `${angSeguro}°`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (atualizarSlider && sliderEl) sliderEl.value = String(angSeguro);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.tecladoDatilografo = new TecladoDatilografoController();
});