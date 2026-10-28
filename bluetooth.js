/**
 * ============================================================================
 * bluetooth.js — Módulo Web Bluetooth BLE para LibraTronic (ESP32 - 6 Servos)
 * Versão 7.0 — Chunking GATT (<=18 bytes) + Calibração Ao Vivo de Graus
 * ============================================================================
 * REGRAS MECÂNICAS INVIOLÁVEIS:
 *   - 90°  = Dedo completamente reto (estendido / aberto)
 *   - 180° = Dedo completamente curvado (flexionado / fechado)
 *   - NENHUM número menor que 90° é permitido em nenhuma circunstância!
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LibraTronicBluetooth = factory();
    root.libratronicBT = new root.LibraTronicBluetooth();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLE_CONFIG = Object.freeze({
    DEVICE_NAME: 'LibraTronic',
    NAME_PREFIXES: ['LibraTronic', 'Libra', 'ESP32'],
    SERVICE_UUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
    CHARACTERISTIC_UUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
    MAX_RECONNECT_ATTEMPTS: 3,
    RECONNECT_DELAY_MS: 1000,
    WRITE_TIMEOUT_MS: 1500,
    BLE_CHUNK_SIZE: 18,   // Máximo 18 bytes por pacote GATT (evita corte de 20 bytes no Windows/Chrome!)
    MIN_SAFE_ANGLE: 90,   // Dedo reto — NUNCA MENOR QUE 90°!
    MAX_SAFE_ANGLE: 180,  // Dedo totalmente curvado
    DEFAULT_WRIST_NEUTRAL: 150 // Pulso alinhado (em 90° ficava virado para a esquerda)
  });

  function sanitizarAngulo(angulo) {
    const valor = Math.round(Number(angulo));
    if (isNaN(valor)) return BLE_CONFIG.MIN_SAFE_ANGLE;
    if (valor < BLE_CONFIG.MIN_SAFE_ANGLE) return BLE_CONFIG.MIN_SAFE_ANGLE;
    if (valor > BLE_CONFIG.MAX_SAFE_ANGLE) return BLE_CONFIG.MAX_SAFE_ANGLE;
    return valor;
  }

  // Recupera pulso neutro salvo pelo usuário ou usa 150°
  let pulsoNeutroAtual = BLE_CONFIG.DEFAULT_WRIST_NEUTRAL;
  try {
    const salvo = localStorage.getItem('libratronic_pulso_neutro');
    if (salvo !== null) pulsoNeutroAtual = sanitizarAngulo(salvo);
  } catch (_) {}

  /**
   * Tabela Oficial de Calibração para 6 Servos (A–Z e Repouso)
   * 90° = Dedo Reto | 180° = Dedo Curvado
   */
  const TABELA_PADRAO_6SERVOS = {
    'A': { descricao: 'Punho fechado com polegar reto na lateral', servos: { polegar: 90, indicador: 180, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'B': { descricao: 'Quatro dedos retos verticais, polegar na palma', servos: { polegar: 180, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: pulsoNeutroAtual } },
    'C': { descricao: 'Todos os dedos semi-curvados formando C', servos: { polegar: 135, indicador: 135, medio: 135, anelar: 135, mindinho: 135, pulso: pulsoNeutroAtual } },
    'D': { descricao: 'Indicador reto para cima, demais fechados com polegar', servos: { polegar: 180, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'E': { descricao: 'Dedos flexionados em garra sobre a palma', servos: { polegar: 180, indicador: 150, medio: 150, anelar: 150, mindinho: 150, pulso: pulsoNeutroAtual } },
    'F': { descricao: 'Indicador dobrado com polegar por fora, 3 dedos retos', servos: { polegar: 125, indicador: 180, medio: 90, anelar: 90, mindinho: 90, pulso: pulsoNeutroAtual } },
    'G': { descricao: 'Polegar e indicador retos paralelos, 3 fechados', servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'H': { descricao: 'Indicador e médio retos com giro rápido de punho', servos: { polegar: 135, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'I': { descricao: 'Apenas mindinho reto estendido para cima', servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: pulsoNeutroAtual } },
    'J': { descricao: 'Mindinho reto desenhando a curva do J com o punho', servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: pulsoNeutroAtual } },
    'K': { descricao: 'Indicador e médio em V com impulso de punho', servos: { polegar: 130, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'L': { descricao: 'Polegar e indicador retos em ângulo L', servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'M': { descricao: 'Três dedos semi-curvados apontando para baixo', servos: { polegar: 180, indicador: 140, medio: 140, anelar: 140, mindinho: 180, pulso: 110 } },
    'N': { descricao: 'Dois dedos semi-curvados apontando para baixo', servos: { polegar: 180, indicador: 140, medio: 140, anelar: 180, mindinho: 180, pulso: 110 } },
    'O': { descricao: 'Todos os dedos curvados formando círculo O', servos: { polegar: 160, indicador: 160, medio: 160, anelar: 160, mindinho: 160, pulso: pulsoNeutroAtual } },
    'P': { descricao: 'Configuração de K com punho rotacionado', servos: { polegar: 130, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 95 } },
    'Q': { descricao: 'Configuração de G apontando para baixo', servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 95 } },
    'R': { descricao: 'Indicador e médio retos cruzados', servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'S': { descricao: 'Punho totalmente fechado com polegar à frente', servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'T': { descricao: 'Indicador dobrado com polegar por dentro, 3 retos', servos: { polegar: 145, indicador: 180, medio: 90, anelar: 90, mindinho: 90, pulso: pulsoNeutroAtual } },
    'U': { descricao: 'Indicador e médio retos e unidos', servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'V': { descricao: 'Indicador e médio retos e afastados em V', servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'W': { descricao: 'Três dedos retos (indicador, médio e anelar)', servos: { polegar: 180, indicador: 90, medio: 90, anelar: 90, mindinho: 180, pulso: pulsoNeutroAtual } },
    'X': { descricao: 'Indicador curvado em gancho com puxada', servos: { polegar: 180, indicador: 140, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'Y': { descricao: 'Polegar e mindinho retos estendidos (shaka)', servos: { polegar: 90, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: pulsoNeutroAtual } },
    'Z': { descricao: 'Indicador reto traçando Z com o punho', servos: { polegar: 180, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: pulsoNeutroAtual } },
    'REPOUSO': { descricao: 'Mão aberta e alinhada em repouso', servos: { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: pulsoNeutroAtual } }
  };

  // Carrega calibrações customizadas salvas pelo usuário se existirem
  try {
    const customSalvo = localStorage.getItem('libratronic_custom_letras_v7');
    if (customSalvo) {
      const parsed = JSON.parse(customSalvo);
      Object.keys(parsed).forEach(k => {
        if (TABELA_PADRAO_6SERVOS[k] && parsed[k].servos) {
          TABELA_PADRAO_6SERVOS[k].servos = {
            polegar: sanitizarAngulo(parsed[k].servos.polegar),
            indicador: sanitizarAngulo(parsed[k].servos.indicador),
            medio: sanitizarAngulo(parsed[k].servos.medio),
            anelar: sanitizarAngulo(parsed[k].servos.anelar),
            mindinho: sanitizarAngulo(parsed[k].servos.mindinho),
            pulso: sanitizarAngulo(parsed[k].servos.pulso)
          };
        }
      });
    }
  } catch (_) {}

  class LibraTronicBluetooth {
    constructor() {
      this.device = null;
      this.server = null;
      this.service = null;
      this.characteristic = null;
      this.conectado = false;
      this.conectando = false;
      this.desconexaoManual = false;
      this.tentativasReconexao = 0;
      this.timerReconexao = null;

      this.filaComandos = [];
      this.inverterPolInd = false;
      this.escrevendoGatt = false;
      this.timerSequencia = null;
      this.timersInterpolacao = [];

      // Velocidade da mão física (15% a 100%). Padrão reduzido para 55% (movimento suave e seguro)
      this.velocidadeMao = 55;
      try {
        const velSalva = localStorage.getItem('libratronic_velocidade_mao');
        if (velSalva !== null) {
          const v = Math.round(Number(velSalva));
          if (!isNaN(v) && v >= 15 && v <= 100) this.velocidadeMao = v;
        }
      } catch (_) {}

      this.ultimoAngulo = {
        polegar: 90,
        indicador: 90,
        medio: 90,
        anelar: 90,
        mindinho: 90,
        pulso: pulsoNeutroAtual
      };

      this.ouvintes = {
        status: [],
        conectado: [],
        desconectado: [],
        comandoEnviado: [],
        velocidadeAlterada: [],
        erro: []
      };

      this._onDisconnectedBound = this._handleDisconnected.bind(this);
    }

    static isSuportado() {
      return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    }

    static getTabelaLetras() {
      return TABELA_PADRAO_6SERVOS;
    }

    getVelocidadeMao() {
      return this.velocidadeMao;
    }

    setVelocidadeMao(novaVel) {
      const v = Math.max(15, Math.min(100, Math.round(Number(novaVel) || 55)));
      this.velocidadeMao = v;
      try {
        localStorage.setItem('libratronic_velocidade_mao', String(v));
      } catch (_) {}
      if (this.conectado && this.characteristic) {
        this._enfileirarComando(`<VEL:${v}>`, { tipo: 'velocidade', velocidade: v });
      }
      this._disparar('velocidadeAlterada', { velocidade: v });
      return v;
    }

    /**
     * Retorna multiplicador de tempo para soletração de frases de acordo com a velocidade da mão física.
     * Em 55% (padrão suave) retorna ~1.45x mais tempo entre letras; em 20% retorna ~2.2x; em 100% retorna 1.0x.
     */
    getFatorTempoMovimento() {
      const v = this.velocidadeMao || 55;
      return 1 + ((100 - v) / 85) * 1.25;
    }

    _cancelarInterpolacao() {
      if (this.timerSequencia) {
        clearTimeout(this.timerSequencia);
        this.timerSequencia = null;
      }
      if (this.timersInterpolacao && this.timersInterpolacao.length > 0) {
        this.timersInterpolacao.forEach((t) => clearTimeout(t));
        this.timersInterpolacao = [];
      }
    }

    getPulsoNeutro() {
      return pulsoNeutroAtual;
    }

    setPulsoNeutro(novoAngulo) {
      const ang = sanitizarAngulo(novoAngulo);
      const antigo = pulsoNeutroAtual;
      pulsoNeutroAtual = ang;
      try {
        localStorage.setItem('libratronic_pulso_neutro', String(ang));
      } catch (_) {}

      // Atualiza todas as letras que usavam o pulso neutro
      Object.keys(TABELA_PADRAO_6SERVOS).forEach(k => {
        const s = TABELA_PADRAO_6SERVOS[k].servos;
        if (s.pulso === antigo || k === 'REPOUSO') {
          s.pulso = ang;
        }
      });
      this._salvarTabelaCustom();
      return ang;
    }

    salvarPoseLetra(letra, novosServos) {
      const l = String(letra).trim().toUpperCase();
      if (!TABELA_PADRAO_6SERVOS[l]) return false;
      TABELA_PADRAO_6SERVOS[l].servos = {
        polegar: sanitizarAngulo(novosServos.polegar),
        indicador: sanitizarAngulo(novosServos.indicador),
        medio: sanitizarAngulo(novosServos.medio),
        anelar: sanitizarAngulo(novosServos.anelar),
        mindinho: sanitizarAngulo(novosServos.mindinho),
        pulso: sanitizarAngulo(novosServos.pulso)
      };
      this._salvarTabelaCustom();
      return true;
    }

    resetarCalibracaoPadrao() {
      try {
        localStorage.removeItem('libratronic_custom_letras_v7');
        localStorage.removeItem('libratronic_pulso_neutro');
      } catch (_) {}
      window.location.reload();
    }

    _salvarTabelaCustom() {
      try {
        localStorage.setItem('libratronic_custom_letras_v7', JSON.stringify(TABELA_PADRAO_6SERVOS));
      } catch (_) {}
    }

    on(evento, callback) {
      if (this.ouvintes[evento] && typeof callback === 'function') {
        this.ouvintes[evento].push(callback);
      }
      return this;
    }

    off(evento, callback) {
      if (this.ouvintes[evento]) {
        this.ouvintes[evento] = this.ouvintes[evento].filter(cb => cb !== callback);
      }
      return this;
    }

    _disparar(evento, dados) {
      if (this.ouvintes[evento]) {
        this.ouvintes[evento].forEach(cb => {
          try { cb(dados); } catch (e) { console.error('[LibraTronic BLE Event Error]', e); }
        });
      }
    }

    _notificarStatus(estado, mensagem, dispositivo = null) {
      this._disparar('status', { estado, mensagem, dispositivo });
    }

    async conectar() {
      if (!LibraTronicBluetooth.isSuportado()) {
        const erroMsg = 'Web Bluetooth não suportado neste navegador. Use Chrome ou Edge.';
        this._disparar('erro', new Error(erroMsg));
        this._notificarStatus('erro', erroMsg);
        return false;
      }

      if (this.conectando) return false;

      this._limparTimerReconexao();
      this.desconexaoManual = false;
      this.conectando = true;
      this._notificarStatus('conectando', 'Procurando hardware ESP32 LibraTronic...');

      try {
        if (this.device) {
          this.device.removeEventListener('gattserverdisconnected', this._onDisconnectedBound);
        }

        const opcoesFiltro = {
          filters: [
            { name: BLE_CONFIG.DEVICE_NAME },
            ...BLE_CONFIG.NAME_PREFIXES.map(prefix => ({ namePrefix: prefix })),
            { services: [BLE_CONFIG.SERVICE_UUID] }
          ],
          optionalServices: [BLE_CONFIG.SERVICE_UUID]
        };

        try {
          this.device = await navigator.bluetooth.requestDevice(opcoesFiltro);
        } catch (filtroErr) {
          const msg = String(filtroErr?.message || '');
          if (!msg.toLowerCase().includes('cancel')) {
            this.device = await navigator.bluetooth.requestDevice({
              acceptAllDevices: true,
              optionalServices: [BLE_CONFIG.SERVICE_UUID]
            });
          } else {
            throw filtroErr;
          }
        }

        this.device.addEventListener('gattserverdisconnected', this._onDisconnectedBound);
        await this._estabelecerConexaoGatt();
        return true;
      } catch (err) {
        this.conectando = false;
        const msg = err?.message || String(err);
        if (msg.toLowerCase().includes('cancel')) {
          this._notificarStatus('desconectado', 'Pareamento cancelado pelo usuário.');
        } else {
          this._notificarStatus('erro', `Falha ao conectar: ${msg}`);
          this._disparar('erro', err);
        }
        return false;
      }
    }

    async _estabelecerConexaoGatt() {
      if (!this.device || !this.device.gatt) throw new Error('Dispositivo BLE sem GATT.');

      this._notificarStatus('conectando', 'Conectando ao ESP32...');
      this.server = await this.device.gatt.connect();

      this._notificarStatus('conectando', 'Acessando serviço...');
      this.service = await this.server.getPrimaryService(BLE_CONFIG.SERVICE_UUID);

      this._notificarStatus('conectando', 'Canal pronto...');
      this.characteristic = await this.service.getCharacteristic(BLE_CONFIG.CHARACTERISTIC_UUID);

      this.conectado = true;
      this.conectando = false;
      this.tentativasReconexao = 0;
      this.filaComandos = [];
      this.escrevendoGatt = false;

      const nomeDispositivo = this.device.name || BLE_CONFIG.DEVICE_NAME;
      this._notificarStatus('conectado', `Conectado ao ESP32 (${nomeDispositivo})`, nomeDispositivo);
      this._disparar('conectado', { nome: nomeDispositivo, device: this.device });

      this._enfileirarComando(`<VEL:${this.velocidadeMao}>`, { tipo: 'velocidade', velocidade: this.velocidadeMao });
      this.enviarRepouso();
    }

    _handleDisconnected() {
      this.conectado = false;
      this.conectando = false;
      this.characteristic = null;
      this.filaComandos = [];
      this.escrevendoGatt = false;

      this._disparar('desconectado', { manual: this.desconexaoManual });

      if (this.desconexaoManual) {
        this._notificarStatus('desconectado', 'Bluetooth desconectado.');
        return;
      }

      this._notificarStatus('desconectado', 'Conexão perdida. Tentando reconectar...');
      this._agendarReconexaoAutomatica();
    }

    _agendarReconexaoAutomatica() {
      if (this.desconexaoManual || !this.device) return;

      if (this.tentativasReconexao >= BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        this.tentativasReconexao = 0;
        this._notificarStatus('desconectado', 'Reconexão falhou. Conecte manualmente.');
        return;
      }

      this.tentativasReconexao++;
      const delay = BLE_CONFIG.RECONNECT_DELAY_MS * Math.pow(1.3, this.tentativasReconexao - 1);
      this._notificarStatus('conectando', `Reconectando (${this.tentativasReconexao}/${BLE_CONFIG.MAX_RECONNECT_ATTEMPTS})...`);

      this._limparTimerReconexao();
      this.timerReconexao = setTimeout(async () => {
        if (this.desconexaoManual || !this.device) return;
        try {
          this.conectando = true;
          await this._estabelecerConexaoGatt();
        } catch (_) {
          this.conectando = false;
          this._agendarReconexaoAutomatica();
        }
      }, delay);
    }

    _limparTimerReconexao() {
      if (this.timerReconexao) {
        clearTimeout(this.timerReconexao);
        this.timerReconexao = null;
      }
    }

    desconectar() {
      this.desconexaoManual = true;
      this._limparTimerReconexao();

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this._onDisconnectedBound);
        if (this.device.gatt && this.device.gatt.connected) {
          try { this.device.gatt.disconnect(); } catch (_) {}
        }
      }

      this.conectado = false;
      this.conectando = false;
      this.characteristic = null;
      this.filaComandos = [];
      this.escrevendoGatt = false;
      this._notificarStatus('desconectado', 'Bluetooth desconectado.');
      this._disparar('desconectado', { manual: true });
    }

    /**
     * Envia a letra juntamente com os 6 ângulos exatos mostrados no site!
     * Inclui proteção anti-colisão: se o Indicador precisar voltar (abrir) enquanto
     * o Polegar estava fechado, envia primeiro a abertura do Polegar (90°) antes de mover o Indicador!
     */
    enviarLetra(letra) {
      if (!letra) return null;
      const letraLimpa = String(letra).trim().toUpperCase();
      const config = TABELA_PADRAO_6SERVOS[letraLimpa];
      if (!config) return null;

      this._cancelarInterpolacao();

      const p  = sanitizarAngulo(config.servos.polegar);
      const i  = sanitizarAngulo(config.servos.indicador);
      const m  = sanitizarAngulo(config.servos.medio);
      const a  = sanitizarAngulo(config.servos.anelar);
      const mi = sanitizarAngulo(config.servos.mindinho);
      const pu = sanitizarAngulo(config.servos.pulso);

      this._executarComSegurancaPolegar(p, i, m, a, mi, pu, (pEnv, iEnv) => {
        const comando = `<L:${letraLimpa}:${pEnv},${iEnv},${m},${a},${mi},${pu}>`;
        this._enfileirarComando(comando, {
          tipo: 'letra',
          letra: letraLimpa,
          descricao: config.descricao,
          angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
        });
      });

      const pEnv = this.inverterPolInd ? i : p;
      const iEnv = this.inverterPolInd ? p : i;
      const comando = `<L:${letraLimpa}:${pEnv},${iEnv},${m},${a},${mi},${pu}>`;

      return {
        letra: letraLimpa,
        comando,
        descricao: config.descricao,
        angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
      };
    }

    /**
     * Executa uma fase de rampa suave dividindo o deslocamento angular em passos progressivos
     * de acordo com `this.velocidadeMao` (15% a 100%).
     */
    _executarRampaFase(alvoFase, enviarUltimoPasso, aoConcluir) {
      const orig = { ...this.ultimoAngulo };
      const vel = Math.max(15, Math.min(100, this.velocidadeMao || 55));
      const fatorLentidao = (100 - vel) / 85; // 0.0 (100%) a 1.0 (15%)

      // Em 100%: passo máx 50°, intervalo 55ms | Em 55% (padrão): passo máx 24°, intervalo 100ms | Em 15%: passo máx 15°, intervalo 145ms
      const passoMaxGraus = Math.max(14, Math.round(50 - fatorLentidao * 35));
      const intervaloPassoMs = Math.round(55 + fatorLentidao * 90);

      const maxDelta = Math.max(
        Math.abs(alvoFase.polegar - orig.polegar),
        Math.abs(alvoFase.indicador - orig.indicador),
        Math.abs(alvoFase.medio - orig.medio),
        Math.abs(alvoFase.anelar - orig.anelar),
        Math.abs(alvoFase.mindinho - orig.mindinho),
        Math.abs(alvoFase.pulso - orig.pulso)
      );

      const totalPassos = Math.max(1, Math.ceil(maxDelta / passoMaxGraus));

      if (totalPassos <= 1) {
        this.ultimoAngulo = { ...alvoFase };
        if (enviarUltimoPasso) {
          const pEnv = this.inverterPolInd ? alvoFase.indicador : alvoFase.polegar;
          const iEnv = this.inverterPolInd ? alvoFase.polegar : alvoFase.indicador;
          this._enfileirarComando(
            `<ANG:${pEnv},${iEnv},${alvoFase.medio},${alvoFase.anelar},${alvoFase.mindinho},${alvoFase.pulso}>`,
            { tipo: 'rampa-passo' }
          );
        }
        if (aoConcluir) aoConcluir();
        return;
      }

      const limitePassoIntermediario = enviarUltimoPasso ? totalPassos : totalPassos - 1;

      for (let step = 1; step <= limitePassoIntermediario; step++) {
        const delayMs = (step - 1) * intervaloPassoMs;
        const timerId = setTimeout(() => {
          const frac = step / totalPassos;
          const pStep  = sanitizarAngulo(orig.polegar   + (alvoFase.polegar   - orig.polegar)   * frac);
          const iStep  = sanitizarAngulo(orig.indicador + (alvoFase.indicador - orig.indicador) * frac);
          const mStep  = sanitizarAngulo(orig.medio     + (alvoFase.medio     - orig.medio)     * frac);
          const aStep  = sanitizarAngulo(orig.anelar    + (alvoFase.anelar    - orig.anelar)    * frac);
          const miStep = sanitizarAngulo(orig.mindinho  + (alvoFase.mindinho  - orig.mindinho)  * frac);
          const puStep = sanitizarAngulo(orig.pulso     + (alvoFase.pulso     - orig.pulso)     * frac);

          this.ultimoAngulo = { polegar: pStep, indicador: iStep, medio: mStep, anelar: aStep, mindinho: miStep, pulso: puStep };

          const pEnv = this.inverterPolInd ? iStep : pStep;
          const iEnv = this.inverterPolInd ? pStep : iStep;
          this._enfileirarComando(`<ANG:${pEnv},${iEnv},${mStep},${aStep},${miStep},${puStep}>`, { tipo: 'rampa-passo' });
        }, delayMs);
        this.timersInterpolacao.push(timerId);
      }

      const tempoTotalFase = (totalPassos - 1) * intervaloPassoMs + (enviarUltimoPasso ? intervaloPassoMs : 0);
      const timerFim = setTimeout(() => {
        this.ultimoAngulo = { ...alvoFase };
        if (aoConcluir) aoConcluir();
      }, tempoTotalFase);
      this.timersInterpolacao.push(timerFim);
    }

    /**
     * Garante que o Polegar SEMPRE volte (abra para 90°) antes do Indicador voltar,
     * e que o Indicador feche antes do Polegar fechar por cima, evitando travar o fio,
     * aplicando também a rampa de velocidade suave escolhida pelo usuário!
     */
    _executarComSegurancaPolegar(p, i, m, a, mi, pu, callbackFinal) {
      const antP = this.ultimoAngulo.polegar;
      const antI = this.ultimoAngulo.indicador;

      const vel = Math.max(15, Math.min(100, this.velocidadeMao || 55));
      const fatorLentidao = (100 - vel) / 85;
      const pausaAntiColisaoMs = Math.round(190 + fatorLentidao * 210);

      const indicadorVaiAbrir = (i < antI - 5);
      const polegarVaiAbrir   = (p < antP - 5);
      const polegarEstavaFechado = (antP > 105);

      const dispararFinal = () => {
        this.ultimoAngulo = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
        const pEnv = this.inverterPolInd ? i : p;
        const iEnv = this.inverterPolInd ? p : i;
        callbackFinal(pEnv, iEnv);
      };

      // Caso 1: O indicador vai voltar (abrir) e o dedão estava fechado (ou ambos vão abrir)
      // -> Fase 1: abre o dedão suavemente primeiro | Fase 2: move indicador e demais dedos
      if ((indicadorVaiAbrir && (polegarEstavaFechado || p > 105)) || (polegarVaiAbrir && indicadorVaiAbrir)) {
        const pSeguro = (p < 105) ? p : 90;
        const fase1 = {
          polegar: pSeguro,
          indicador: antI,
          medio: this.ultimoAngulo.medio,
          anelar: this.ultimoAngulo.anelar,
          mindinho: this.ultimoAngulo.mindinho,
          pulso: pu
        };

        this._executarRampaFase(fase1, true, () => {
          this.timerSequencia = setTimeout(() => {
            this.timerSequencia = null;
            if (p !== pSeguro) {
              // Se a letra final exige o polegar fechado após o indicador abrir, abre o indicador com polegar em 90° e depois fecha o polegar
              const fase2 = { polegar: pSeguro, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
              this._executarRampaFase(fase2, true, () => {
                const t3 = setTimeout(() => {
                  const fase3 = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
                  this._executarRampaFase(fase3, false, dispararFinal);
                }, Math.round(pausaAntiColisaoMs * 0.75));
                this.timersInterpolacao.push(t3);
              });
            } else {
              const fase2 = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
              this._executarRampaFase(fase2, false, dispararFinal);
            }
          }, pausaAntiColisaoMs);
        });
      }
      // Caso 2: Ambos vão fechar (ex: Repouso -> E/M/N/S) -> Fecha o indicador e demais dedos primeiro, depois o dedão
      else if (i > antI + 10 && p > 115) {
        const pSeguro = 90;
        const fase1 = { polegar: pSeguro, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
        this._executarRampaFase(fase1, true, () => {
          this.timerSequencia = setTimeout(() => {
            this.timerSequencia = null;
            const fase2 = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
            this._executarRampaFase(fase2, false, dispararFinal);
          }, Math.round(pausaAntiColisaoMs * 0.85));
        });
      }
      // Caso 3: Sem risco de colisão -> Interpola suavemente todos os dedos até o alvo
      else {
        const faseUnica = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
        this._executarRampaFase(faseUnica, false, dispararFinal);
      }
    }

    /**
     * Envia os 6 ângulos exatos imediatamente (usado quando o usuário move um slider na tela).
     */
    enviarAngulos(polegar, indicador, medio, anelar, mindinho, pulso = pulsoNeutroAtual) {
      this._cancelarInterpolacao();
      const p  = sanitizarAngulo(polegar);
      const i  = sanitizarAngulo(indicador);
      const m  = sanitizarAngulo(medio);
      const a  = sanitizarAngulo(anelar);
      const mi = sanitizarAngulo(mindinho);
      const pu = sanitizarAngulo(pulso);

      this.ultimoAngulo = { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
      const pEnv = this.inverterPolInd ? i : p;
      const iEnv = this.inverterPolInd ? p : i;
      const comando = `<ANG:${pEnv},${iEnv},${m},${a},${mi},${pu}>`;
      this._enfileirarComando(comando, {
        tipo: 'angulos',
        angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
      });

      return { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu, comando };
    }

    alterarPinoServo(canal, novoGpio) {
      const comando = `<PIN:${canal}:${novoGpio}>`;
      this._enfileirarComando(comando, { tipo: 'pino', canal, gpio: novoGpio });
    }

    testarServo(canal, angulo) {
      const ang = sanitizarAngulo(angulo);
      const comando = `<TEST:${canal}:${ang}>`;
      this._enfileirarComando(comando, { tipo: 'teste', canal, angulo: ang });
    }

    enviarRepouso() {
      this._cancelarInterpolacao();
      const pu = sanitizarAngulo(pulsoNeutroAtual);
      this._executarComSegurancaPolegar(90, 90, 90, 90, 90, pu, (pEnv, iEnv) => {
        const comando = `<ANG:${pEnv},${iEnv},90,90,90,${pu}>`;
        this._enfileirarComando(comando, {
          tipo: 'repouso',
          angulos: { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: pu }
        });
      });
      return { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: pu };
    }

    _enfileirarComando(comando, metadados = {}) {
      if (!this.conectado || !this.characteristic) {
        this._disparar('comandoEnviado', { comando, metadados, offline: true });
        return;
      }

      // Se a fila já tiver comandos pendentes de slider, substitui para manter baixa latência
      if (this.filaComandos.length > 2) {
        this.filaComandos = [this.filaComandos[this.filaComandos.length - 1]];
      }
      this.filaComandos.push({ comando, metadados });
      this._processarFila();
    }

    async _escreverPayloadEmFatias(payloadBytes) {
      const chunkSize = BLE_CONFIG.BLE_CHUNK_SIZE;
      for (let offset = 0; offset < payloadBytes.byteLength; offset += chunkSize) {
        const fatia = payloadBytes.slice(offset, offset + chunkSize);
        const promessa = this.characteristic.writeValueWithoutResponse
          ? this.characteristic.writeValueWithoutResponse(fatia)
          : this.characteristic.writeValue(fatia);

        await Promise.race([
          promessa,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout BLE')), BLE_CONFIG.WRITE_TIMEOUT_MS)
          )
        ]);
      }
    }

    async _processarFila() {
      if (this.escrevendoGatt || !this.conectado || !this.characteristic) return;
      const item = this.filaComandos.shift();
      if (!item) return;

      this.escrevendoGatt = true;
      const payload = new TextEncoder().encode(item.comando);

      try {
        await this._escreverPayloadEmFatias(payload);
        this._disparar('comandoEnviado', { comando: item.comando, metadados: item.metadados, offline: false });
      } catch (err) {
        console.error(`[LibraTronic BLE] Falha no envio (${item.comando}):`, err);
        this._disparar('erro', err);
        this._handleDisconnected();
        return;
      } finally {
        this.escrevendoGatt = false;
      }

      if (this.filaComandos.length > 0) {
        this._processarFila();
      }
    }

    obterDadosLetra(letra) {
      if (!letra) return null;
      const letraLimpa = String(letra).trim().toUpperCase();
      return TABELA_PADRAO_6SERVOS[letraLimpa] || null;
    }
  }

  return LibraTronicBluetooth;
}));
