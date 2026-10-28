/**
 * ============================================================================
 * bluetooth.js — Módulo Web Bluetooth BLE para LibraTronic (ESP32 - 6 Servos)
 * ============================================================================
 * Permite a conexão Bluetooth BLE direta do navegador com o controlador ESP32
 * da mão robótica biomimética (5 servos dos dedos + 1 servo do pulso).
 *
 * REGRA MECÂNICA FUNDAMENTAL:
 *   - 90°  = Dedo completamente reto (estendido / neutro)
 *   - 180° = Dedo completamente curvado (flexionado / fechado)
 *   - NENHUM número menor que 90° é permitido em nenhuma circunstância!
 *     Qualquer valor < 90° travará o sistema mecânico da mão 3D.
 *
 * Compatibilidade:
 *   - Google Chrome, Microsoft Edge, Opera (Desktop & Android via Web Bluetooth)
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LibraTronicBluetooth = factory();
    // Atalho global para conveniência
    root.libratronicBT = new root.LibraTronicBluetooth();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Configurações padrão do serviço BLE no ESP32
  const BLE_CONFIG = Object.freeze({
    DEVICE_NAME: 'LibraTronic',
    NAME_PREFIXES: ['LibraTronic', 'Libra', 'ESP32'],
    SERVICE_UUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
    CHARACTERISTIC_UUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
    MAX_RECONNECT_ATTEMPTS: 3,
    RECONNECT_DELAY_MS: 1200,
    WRITE_TIMEOUT_MS: 2500,
    MIN_SAFE_ANGLE: 90,   // Dedo reto — NUNCA MENOR QUE 90°!
    MAX_SAFE_ANGLE: 180   // Dedo totalmente curvado
  });

  /**
   * Garante rigidamente que nenhum ângulo seja inferior a 90° nem superior a 180°.
   * @param {number} angulo
   * @returns {number} Ângulo contido estritamente em [90, 180]
   */
  function sanitizarAngulo(angulo) {
    const valor = Math.round(Number(angulo));
    if (isNaN(valor)) return BLE_CONFIG.MIN_SAFE_ANGLE;
    if (valor < BLE_CONFIG.MIN_SAFE_ANGLE) {
      console.warn(`[LibraTronic BLE] ALERTA: Ângulo ${valor}° é menor que 90°! Corrigido automaticamente para 90°.`);
      return BLE_CONFIG.MIN_SAFE_ANGLE;
    }
    if (valor > BLE_CONFIG.MAX_SAFE_ANGLE) {
      return BLE_CONFIG.MAX_SAFE_ANGLE;
    }
    return valor;
  }

  /**
   * Tabela Oficial de Calibração Mecânica para 6 Servos (A–Z e Repouso)
   * Formato: [Polegar, Indicador, Médio, Anelar, Mindinho, Pulso]
   * Valores: 90° (reto) a 180° (completamente curvado)
   */
  const TABELA_LETRAS_6SERVOS = Object.freeze({
    'A': {
      descricao: 'Punho fechado, polegar encostado na lateral',
      servos: { polegar: 90, indicador: 180, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'B': {
      descricao: 'Quatro dedos retos verticais, polegar na palma',
      servos: { polegar: 180, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: 90 }
    },
    'C': {
      descricao: 'Todos os dedos curvados formando a letra C',
      servos: { polegar: 135, indicador: 135, medio: 135, anelar: 135, mindinho: 135, pulso: 90 }
    },
    'D': {
      descricao: 'Indicador reto, demais dedos tocam o polegar',
      servos: { polegar: 175, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'E': {
      descricao: 'Dedos flexionados em garra sobre a palma',
      servos: { polegar: 180, indicador: 155, medio: 155, anelar: 155, mindinho: 155, pulso: 90 }
    },
    'F': {
      descricao: 'Indicador dobrado com polegar por fora, 3 dedos retos',
      servos: { polegar: 120, indicador: 175, medio: 90, anelar: 90, mindinho: 90, pulso: 90 }
    },
    'G': {
      descricao: 'Indicador e polegar retos apontando para cima',
      servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'H': {
      descricao: 'Indicador e médio retos horizontais com giro de pulso',
      servos: { polegar: 130, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 140 }
    },
    'I': {
      descricao: 'Mindinho reto estendido para cima',
      servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: 90 }
    },
    'J': {
      descricao: 'Mindinho reto desenhando curva do J no ar',
      servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: 145 }
    },
    'K': {
      descricao: 'Indicador e médio em V com polegar entre eles',
      servos: { polegar: 125, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 115 }
    },
    'L': {
      descricao: 'Indicador e polegar formando ângulo reto L',
      servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'M': {
      descricao: 'Três dedos dobrados apontando para baixo',
      servos: { polegar: 180, indicador: 150, medio: 150, anelar: 150, mindinho: 180, pulso: 120 }
    },
    'N': {
      descricao: 'Dois dedos dobrados apontando para baixo',
      servos: { polegar: 180, indicador: 150, medio: 150, anelar: 180, mindinho: 180, pulso: 120 }
    },
    'O': {
      descricao: 'Todos os dedos curvados formando o círculo O',
      servos: { polegar: 165, indicador: 165, medio: 165, anelar: 165, mindinho: 165, pulso: 90 }
    },
    'P': {
      descricao: 'Configuração de K na horizontal pelo pulso',
      servos: { polegar: 125, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 155 }
    },
    'Q': {
      descricao: 'Configuração de G apontando para baixo',
      servos: { polegar: 90, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 155 }
    },
    'R': {
      descricao: 'Indicador e médio estendidos e cruzados',
      servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'S': {
      descricao: 'Punho fechado com polegar cruzado à frente',
      servos: { polegar: 180, indicador: 180, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'T': {
      descricao: 'Indicador dobrado com polegar por dentro, 3 dedos retos',
      servos: { polegar: 135, indicador: 180, medio: 90, anelar: 90, mindinho: 90, pulso: 90 }
    },
    'U': {
      descricao: 'Indicador e médio retos e unidos verticalmente',
      servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'V': {
      descricao: 'Indicador e médio retos e afastados em V',
      servos: { polegar: 180, indicador: 90, medio: 90, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'W': {
      descricao: 'Três dedos retos e afastados em W',
      servos: { polegar: 180, indicador: 90, medio: 90, anelar: 90, mindinho: 180, pulso: 90 }
    },
    'X': {
      descricao: 'Indicador curvado em gancho puxando para trás',
      servos: { polegar: 140, indicador: 140, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'Y': {
      descricao: 'Polegar e mindinho retos estendidos (shaka)',
      servos: { polegar: 90, indicador: 180, medio: 180, anelar: 180, mindinho: 90, pulso: 90 }
    },
    'Z': {
      descricao: 'Indicador reto traçando o formato de Z',
      servos: { polegar: 180, indicador: 90, medio: 180, anelar: 180, mindinho: 180, pulso: 90 }
    },
    'REPOUSO': {
      descricao: 'Mão totalmente aberta e relaxada (neutro)',
      servos: { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: 90 }
    }
  });

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
      this.escrevendoGatt = false;

      this.ouvintes = {
        status: [],
        conectado: [],
        desconectado: [],
        comandoEnviado: [],
        erro: []
      };

      this._onDisconnectedBound = this._handleDisconnected.bind(this);
    }

    /**
     * Verifica se o navegador atual suporta Web Bluetooth.
     */
    static isSuportado() {
      return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    }

    /**
     * Retorna a tabela completa de letras calibradas para os 6 servos.
     */
    static getTabelaLetras() {
      return TABELA_LETRAS_6SERVOS;
    }

    /**
     * Registra ouvinte de eventos.
     */
    on(evento, callback) {
      if (this.ouvintes[evento] && typeof callback === 'function') {
        this.ouvintes[evento].push(callback);
      }
      return this;
    }

    /**
     * Remove ouvinte de eventos.
     */
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

    /**
     * Inicia a busca e o pareamento com o ESP32.
     */
    async conectar() {
      if (!LibraTronicBluetooth.isSuportado()) {
        const erroMsg = 'Web Bluetooth não é suportado por este navegador. Por favor, use Google Chrome, Microsoft Edge ou Opera.';
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
            console.log('[LibraTronic BLE] Tentando busca ampla por dispositivos BLE...');
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
      if (!this.device || !this.device.gatt) {
        throw new Error('Dispositivo BLE não possui interface GATT disponível.');
      }

      this._notificarStatus('conectando', 'Estabelecendo sessão GATT com o ESP32...');
      this.server = await this.device.gatt.connect();

      this._notificarStatus('conectando', 'Acessando serviço de controle de servos...');
      this.service = await this.server.getPrimaryService(BLE_CONFIG.SERVICE_UUID);

      this._notificarStatus('conectando', 'Obtendo canal de transmissão...');
      this.characteristic = await this.service.getCharacteristic(BLE_CONFIG.CHARACTERISTIC_UUID);

      this.conectado = true;
      this.conectando = false;
      this.tentativasReconexao = 0;
      this.filaComandos = [];
      this.escrevendoGatt = false;

      const nomeDispositivo = this.device.name || BLE_CONFIG.DEVICE_NAME;
      this._notificarStatus('conectado', `Conectado ao ESP32 (${nomeDispositivo})`, nomeDispositivo);
      this._disparar('conectado', { nome: nomeDispositivo, device: this.device });

      // Envia comando inicial de repouso (mão aberta segura a 90° em todos os 6 servos)
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
        this._notificarStatus('desconectado', 'Dispositivo desconectado.');
        return;
      }

      this._notificarStatus('desconectado', 'Conexão perdida com o ESP32.');
      this._agendarReconexaoAutomatica();
    }

    _agendarReconexaoAutomatica() {
      if (this.desconexaoManual || !this.device) return;

      if (this.tentativasReconexao >= BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        this.tentativasReconexao = 0;
        this._notificarStatus('desconectado', 'Não foi possível restabelecer conexão automaticamente.');
        return;
      }

      this.tentativasReconexao++;
      const delay = BLE_CONFIG.RECONNECT_DELAY_MS * Math.pow(1.5, this.tentativasReconexao - 1);
      this._notificarStatus(
        'conectando',
        `Reconectando automaticamente (${this.tentativasReconexao}/${BLE_CONFIG.MAX_RECONNECT_ATTEMPTS})...`
      );

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

    /**
     * Encerra a conexão Bluetooth com segurança.
     */
    desconectar() {
      this.desconexaoManual = true;
      this._limparTimerReconexao();

      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this._onDisconnectedBound);
        if (this.device.gatt && this.device.gatt.connected) {
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
      this._notificarStatus('desconectado', 'Bluetooth desconectado com sucesso.');
      this._disparar('desconectado', { manual: true });
    }

    /**
     * Envia uma letra do alfabeto para a mão física (A–Z).
     * @param {string} letra Caractere da letra desejada.
     */
    enviarLetra(letra) {
      if (!letra) return null;
      const letraLimpa = String(letra).trim().toUpperCase();
      const config = TABELA_LETRAS_6SERVOS[letraLimpa];

      if (!config) {
        console.warn(`[LibraTronic BLE] Letra '${letraLimpa}' não encontrada na tabela de datilologia.`);
        return null;
      }

      const { polegar, indicador, medio, anelar, mindinho, pulso } = config.servos;

      // Validação estrita: NENHUM número menor que 90°!
      const p  = sanitizarAngulo(polegar);
      const i  = sanitizarAngulo(indicador);
      const m  = sanitizarAngulo(medio);
      const a  = sanitizarAngulo(anelar);
      const mi = sanitizarAngulo(mindinho);
      const pu = sanitizarAngulo(pulso);

      // Enviamos o pacote com a letra e os 6 ângulos no formato padronizado:
      // Exemplo: <L:A:90,180,180,180,180,90>
      const comando = `<L:${letraLimpa}:${p},${i},${m},${a},${mi},${pu}>`;
      this._enfileirarComando(comando, {
        tipo: 'letra',
        letra: letraLimpa,
        descricao: config.descricao,
        angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
      });

      return {
        letra: letraLimpa,
        descricao: config.descricao,
        angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
      };
    }

    /**
     * Envia ângulos manuais para os 6 servos com trava estrita de segurança (90° a 180°).
     * @param {number} polegar 90..180
     * @param {number} indicador 90..180
     * @param {number} medio 90..180
     * @param {number} anelar 90..180
     * @param {number} mindinho 90..180
     * @param {number} pulso 90..180
     */
    enviarAngulos(polegar, indicador, medio, anelar, mindinho, pulso = 90) {
      const p  = sanitizarAngulo(polegar);
      const i  = sanitizarAngulo(indicador);
      const m  = sanitizarAngulo(medio);
      const a  = sanitizarAngulo(anelar);
      const mi = sanitizarAngulo(mindinho);
      const pu = sanitizarAngulo(pulso);

      const comando = `<ANG:${p},${i},${m},${a},${mi},${pu}>`;
      this._enfileirarComando(comando, {
        tipo: 'angulos',
        angulos: { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu }
      });

      return { polegar: p, indicador: i, medio: m, anelar: a, mindinho: mi, pulso: pu };
    }

    /**
     * Envia comando de repouso (mão aberta com todos os servos em 90°).
     */
    enviarRepouso() {
      const comando = '<REST>';
      this._enfileirarComando(comando, {
        tipo: 'repouso',
        angulos: { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: 90 }
      });
      return { polegar: 90, indicador: 90, medio: 90, anelar: 90, mindinho: 90, pulso: 90 };
    }

    /**
     * Envia comando de string pura (ex: '<CMD_A>').
     */
    enviarRaw(str) {
      if (!str) return;
      const comando = str.startsWith('<') && str.endsWith('>') ? str : `<${str}>`;
      this._enfileirarComando(comando, { tipo: 'raw', comando });
    }

    _enfileirarComando(comando, metadados = {}) {
      if (!this.conectado || !this.characteristic) {
        // Dispara evento mesmo offline para fins de telemetria/UI
        this._disparar('comandoEnviado', { comando, metadados, offline: true });
        return;
      }

      // Evita duplicar se for idêntico ao último na fila
      const ultimo = this.filaComandos[this.filaComandos.length - 1];
      if (!ultimo || ultimo.comando !== comando) {
        this.filaComandos.push({ comando, metadados });
      }

      this._processarFila();
    }

    async _processarFila() {
      if (this.escrevendoGatt || !this.conectado || !this.characteristic) return;
      const item = this.filaComandos.shift();
      if (!item) return;

      this.escrevendoGatt = true;
      const payload = new TextEncoder().encode(item.comando);

      try {
        const promessaEscrita = this.characteristic.writeValueWithoutResponse
          ? this.characteristic.writeValueWithoutResponse(payload)
          : this.characteristic.writeValue(payload);

        await Promise.race([
          promessaEscrita,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout de escrita BLE')), BLE_CONFIG.WRITE_TIMEOUT_MS)
          )
        ]);

        this._disparar('comandoEnviado', { comando: item.comando, metadados: item.metadados, offline: false });
      } catch (err) {
        console.error(`[LibraTronic BLE] Erro no envio (${item.comando}):`, err);
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
      return TABELA_LETRAS_6SERVOS[letraLimpa] || null;
    }
  }

  return LibraTronicBluetooth;
}));
