// ============================================================================
// LibraTronic_ESP32_6Servos.ino — Firmware v8.0 (Correção Pinos & Dedo Médio)
// Mão Biônica Biomimética 3D (5 Dedos + 1 Pulso = 6 Servomotores)
//
// CORREÇÕES DESTA VERSÃO (v8.0):
//   1. Polegar e Indicador destrocados:
//      - Polegar   → GPIO 12
//      - Indicador → GPIO 13
//   2. Correção Definitiva do Dedo Médio:
//      - Reset de função JTAG (MTMS) no GPIO 14 + attach com pulso explícito (500..2400us).
//      - Espelhamento simultâneo do Dedo Médio nos pinos livres vizinhos
//        (GPIO 14, GPIO 33, GPIO 32, GPIO 15 e GPIO 4) caso o fio do servo do
//        dedo médio esteja conectado em outro pino da fileira!
//      - Suporte ao comando <PIN:canal:gpio> para trocar o pino de qualquer
//        dedo em tempo real direto pelo site!
//   3. Regra Inviolável Mantida: 90° (Reto) a 180° (Curvado) — NUNCA < 90°.
// ============================================================================

#include <Arduino.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>

// ============================================================================
// 1. CONFIGURAÇÕES BLE
// ============================================================================
#define DEVICE_NAME         "LibraTronic"
#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"

// ============================================================================
// 2. PINAGEM CORRIGIDA DOS 6 SERVOMOTORES NO ESP32
//    (Polegar e Indicador invertidos conforme montagem física real da mão)
// ============================================================================
int pinPolegar   = 12; // Corrigido: era 13, agora é 12
int pinIndicador = 13; // Corrigido: era 12, agora é 13
int pinMedio     = 14; // Pino principal do dedo médio
int pinAnelar    = 27;
int pinMindinho  = 26;
int pinPulso     = 25;

// Pinos extras livres onde o sinal do Dedo Médio também é espelhado
// (Caso o jumper do servo do dedo médio esteja espetado em um pino vizinho!)
#define PIN_MEDIO_ESPELHO_1  33
#define PIN_MEDIO_ESPELHO_2  32
#define PIN_MEDIO_ESPELHO_3  15
#define PIN_MEDIO_ESPELHO_4   4

#define PIN_LED_STATUS        2

// ============================================================================
// 3. LIMITES MECÂNICOS DE SEGURANÇA (90° a 180°)
// ============================================================================
#define ANGULO_MIN_RETO     90   // 90° = Dedo reto (NUNCA USAR < 90°)
#define ANGULO_MAX_CURVADO 180   // 180° = Dedo completamente curvado
#define PULSO_NEUTRO_PADRAO 150  // 150° = Pulso alinhado

// ============================================================================
// 4. OBJETOS DOS SERVOS
// ============================================================================
Servo servoPolegar;
Servo servoIndicador;
Servo servoMedio;
Servo servoAnelar;
Servo servoMindinho;
Servo servoPulso;

// Servos espelho para garantir que o Dedo Médio funcione mesmo em pino vizinho
Servo servoMedioEspelho1;
Servo servoMedioEspelho2;
Servo servoMedioEspelho3;
Servo servoMedioEspelho4;

int posPolegar   = 90;
int posIndicador = 90;
int posMedio     = 90;
int posAnelar    = 90;
int posMindinho  = 90;
int posPulso     = PULSO_NEUTRO_PADRAO;

// Objetos BLE
BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Fila circular de comandos reconstruídos pelo acumulador BLE
#define MAX_FILA 12
String filaComandos[MAX_FILA];
volatile int filaHead = 0;
volatile int filaTail = 0;
String rxBufferAcumulador = "";

void enfileirarComandoBLE(const String& cmd) {
  int nextHead = (filaHead + 1) % MAX_FILA;
  if (nextHead != filaTail) {
    filaComandos[filaHead] = cmd;
    filaHead = nextHead;
  }
}

bool desenfileirarComandoBLE(String& cmdOut) {
  if (filaHead == filaTail) return false;
  cmdOut = filaComandos[filaTail];
  filaTail = (filaTail + 1) % MAX_FILA;
  return true;
}

// ============================================================================
// 5. TABELA OFICIAL DE POSES LIBRAS (A–Z)
// ============================================================================
struct PoseLibras {
  char letra;
  int polegar;
  int indicador;
  int medio;
  int anelar;
  int mindinho;
  int pulso;
  char acaoPulso;
};

const PoseLibras TABELA_LIBRAS[] = {
  { 'A',  90, 180, 180, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'B', 180,  90,  90,  90,  90, PULSO_NEUTRO_PADRAO, '-' },
  { 'C', 135, 135, 135, 135, 135, PULSO_NEUTRO_PADRAO, '-' },
  { 'D', 180,  90, 180, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'E', 180, 150, 150, 150, 150, PULSO_NEUTRO_PADRAO, '-' },
  { 'F', 125, 180,  90,  90,  90, PULSO_NEUTRO_PADRAO, '-' },
  { 'G',  90,  90, 180, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'H', 135,  90,  90, 180, 180, PULSO_NEUTRO_PADRAO, 'H' },
  { 'I', 180, 180, 180, 180,  90, PULSO_NEUTRO_PADRAO, '-' },
  { 'J', 180, 180, 180, 180,  90, PULSO_NEUTRO_PADRAO, 'J' },
  { 'K', 130,  90,  90, 180, 180, PULSO_NEUTRO_PADRAO, 'K' },
  { 'L',  90,  90, 180, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'M', 180, 140, 140, 140, 180, 110,                 '-' },
  { 'N', 180, 140, 140, 180, 180, 110,                 '-' },
  { 'O', 160, 160, 160, 160, 160, PULSO_NEUTRO_PADRAO, '-' },
  { 'P', 130,  90,  90, 180, 180,  95,                 '-' },
  { 'Q',  90,  90, 180, 180, 180,  95,                 '-' },
  { 'R', 180,  90,  90, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'S', 180, 180, 180, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'T', 145, 180,  90,  90,  90, PULSO_NEUTRO_PADRAO, '-' },
  { 'U', 180,  90,  90, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'V', 180,  90,  90, 180, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'W', 180,  90,  90,  90, 180, PULSO_NEUTRO_PADRAO, '-' },
  { 'X', 180, 140, 180, 180, 180, PULSO_NEUTRO_PADRAO, 'X' },
  { 'Y',  90, 180, 180, 180,  90, PULSO_NEUTRO_PADRAO, '-' },
  { 'Z', 180,  90, 180, 180, 180, PULSO_NEUTRO_PADRAO, 'Z' }
};
const int TOTAL_LIBRAS = sizeof(TABELA_LIBRAS) / sizeof(TABELA_LIBRAS[0]);

// ============================================================================
// 6. TRAVA DE SEGURANÇA (NUNCA MENOR QUE 90°)
// ============================================================================
inline int travaSegura(int angulo) {
  if (angulo < ANGULO_MIN_RETO) return ANGULO_MIN_RETO;
  if (angulo > ANGULO_MAX_CURVADO) return ANGULO_MAX_CURVADO;
  return angulo;
}

// Move o servo do Dedo Médio tanto no pino principal quanto nos pinos espelho
void escreverServoMedio(int angulo) {
  angulo = travaSegura(angulo);
  posMedio = angulo;
  servoMedio.write(angulo);
  servoMedioEspelho1.write(angulo);
  servoMedioEspelho2.write(angulo);
  servoMedioEspelho3.write(angulo);
  servoMedioEspelho4.write(angulo);
}

// ============================================================================
// 7. ACIONAMENTO INTELIGENTE ANTI-COLISÃO DOS 6 SERVOMOTORES
// ============================================================================
// Regra mecânica crítica:
// 1) Quando o Indicador precisa VOLTAR (abrir/estender para 90°) ou se mover
//    enquanto o Polegar está fechado (> 105°), o Polegar abre PRIMEIRO para 90°
//    (com folga de 220ms) para não prender o Indicador e não escapar o fio do servo!
// 2) Quando ambos vão FECHAR (curvar para > 115°), o Indicador fecha PRIMEIRO
//    e o Polegar fecha por cima depois (180ms), imitando a anatomia real da mão.
void aplicarAngulos(int p, int i, int m, int a, int mi, int pu) {
  int alvoPolegar   = travaSegura(p);
  int alvoIndicador = travaSegura(i);
  int alvoMedio     = travaSegura(m);
  int alvoAnelar    = travaSegura(a);
  int alvoMindinho  = travaSegura(mi);
  int alvoPulso     = travaSegura(pu);

  bool indicadorVaiAbrir = (alvoIndicador < posIndicador - 5);
  bool polegarVaiAbrir   = (alvoPolegar < posPolegar - 5);
  bool polegarEstavaFechado = (posPolegar > 105);
  bool indicadorEstavaFechado = (posIndicador > 105);

  // Move imediatamente os dedos sem conflito (Médio, Anelar, Mindinho e Pulso)
  escreverServoMedio(alvoMedio);
  servoAnelar.write(alvoAnelar);
  servoMindinho.write(alvoMindinho);
  servoPulso.write(alvoPulso);

  // CASO 1: Indicador vai abrir/voltar e o Polegar estava fechado (ou ambos vão abrir)
  // -> O Polegar SEMPRE abre primeiro para liberar o caminho do Indicador!
  if ((indicadorVaiAbrir && (polegarEstavaFechado || alvoPolegar > 105)) || (polegarVaiAbrir && indicadorVaiAbrir)) {
    int aberturaSeguraPolegar = (alvoPolegar < 105) ? alvoPolegar : ANGULO_MIN_RETO;
    servoPolegar.write(aberturaSeguraPolegar);
    delay(220); // Aguarda o dedão sair da frente do indicador

    servoIndicador.write(alvoIndicador);

    // Se a letra final exigia o polegar fechado mas o indicador abriu, fecha o polegar após o indicador passar
    if (alvoPolegar != aberturaSeguraPolegar) {
      delay(180);
      servoPolegar.write(alvoPolegar);
    }
  }
  // CASO 2: O Polegar vai abrir sozinho
  else if (polegarVaiAbrir) {
    servoPolegar.write(alvoPolegar);
    delay(160);
    servoIndicador.write(alvoIndicador);
  }
  // CASO 3: Indicador e Polegar vão fechar juntos (ex: saindo de Repouso para A, E, M, N, S)
  // -> O Indicador fecha antes para o Polegar não bater nele no meio do caminho!
  else if (alvoIndicador > posIndicador + 10 && alvoPolegar > 115) {
    if (polegarEstavaFechado && indicadorEstavaFechado && alvoIndicador != posIndicador) {
      // Se já estavam fechados e mudam de posição, afasta o polegar rápido antes
      servoPolegar.write(ANGULO_MIN_RETO);
      delay(180);
    }
    servoIndicador.write(alvoIndicador);
    delay(180);
    servoPolegar.write(alvoPolegar);
  }
  // CASO PADRÃO: Movimento sem risco de colisão
  else {
    servoPolegar.write(alvoPolegar);
    servoIndicador.write(alvoIndicador);
  }

  posPolegar   = alvoPolegar;
  posIndicador = alvoIndicador;
  posMedio     = alvoMedio;
  posAnelar    = alvoAnelar;
  posMindinho  = alvoMindinho;
  posPulso     = alvoPulso;

  Serial.printf(">> [SERVOS] Pol(GPIO %d):%d° | Ind(GPIO %d):%d° | Med(GPIO %d+esp):%d° | Ane:%d° | Min:%d° | Pulso:%d°\n",
                pinPolegar, posPolegar, pinIndicador, posIndicador, pinMedio, posMedio, posAnelar, posMindinho, posPulso);
}

// ============================================================================
// 8. ANIMAÇÕES DINÂMICAS RÁPIDAS DO PULSO (H, J, K, X, Z)
// ============================================================================
void animarPulsoDinamico(char acao, int pulsoFinal) {
  pulsoFinal = travaSegura(pulsoFinal);

  switch (acao) {
    case 'H':
      servoPulso.write(90);
      delay(160);
      servoPulso.write(180);
      delay(160);
      servoPulso.write(pulsoFinal);
      posPulso = pulsoFinal;
      break;

    case 'J':
      servoPulso.write(180);
      delay(150);
      servoPulso.write(95);
      delay(180);
      servoPulso.write(pulsoFinal);
      posPulso = pulsoFinal;
      break;

    case 'K':
      servoPulso.write(100);
      delay(130);
      servoPulso.write(175);
      delay(130);
      servoPulso.write(pulsoFinal);
      posPulso = pulsoFinal;
      break;

    case 'X':
      servoPulso.write(115);
      delay(130);
      servoPulso.write(pulsoFinal);
      posPulso = pulsoFinal;
      break;

    case 'Z':
      servoPulso.write(95);
      delay(120);
      servoPulso.write(175);
      delay(120);
      servoPulso.write(105);
      delay(120);
      servoPulso.write(pulsoFinal);
      posPulso = pulsoFinal;
      break;

    default:
      break;
  }
}

void aplicarRepouso(int pulsoNeutro = PULSO_NEUTRO_PADRAO) {
  Serial.printf("[REPOUSO] Dedos em 90° (retos) | Pulso em %d°\n", pulsoNeutro);
  aplicarAngulos(90, 90, 90, 90, 90, pulsoNeutro);
}

bool executarLetraTabela(char letraChar) {
  letraChar = toupper(letraChar);
  for (int idx = 0; idx < TOTAL_LIBRAS; idx++) {
    if (TABELA_LIBRAS[idx].letra == letraChar) {
      aplicarAngulos(
        TABELA_LIBRAS[idx].polegar,
        TABELA_LIBRAS[idx].indicador,
        TABELA_LIBRAS[idx].medio,
        TABELA_LIBRAS[idx].anelar,
        TABELA_LIBRAS[idx].mindinho,
        TABELA_LIBRAS[idx].pulso
      );
      if (TABELA_LIBRAS[idx].acaoPulso != '-') {
        delay(80);
        animarPulsoDinamico(TABELA_LIBRAS[idx].acaoPulso, TABELA_LIBRAS[idx].pulso);
      }
      return true;
    }
  }
  return false;
}

// ============================================================================
// 9. INTERPRETADOR DE COMANDOS BLE / SERIAL
// ============================================================================
void processarComando(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  while (cmd.startsWith("<")) cmd = cmd.substring(1);
  while (cmd.endsWith(">"))   cmd = cmd.substring(0, cmd.length() - 1);
  cmd.trim();

  Serial.printf("[COMANDO RECEBIDO] \"%s\"\n", cmd.c_str());

  // 1. Troca dinâmica de pino GPIO pelo site: "PIN:3:33" (Canal 1..6, novo GPIO)
  if (cmd.startsWith("PIN:")) {
    int canal, novoGpio;
    if (sscanf(cmd.c_str(), "PIN:%d:%d", &canal, &novoGpio) == 2) {
      Serial.printf("[REMAPEAMENTO DE PINO] Canal %d -> GPIO %d\n", canal, novoGpio);
      pinMode(novoGpio, OUTPUT);
      switch (canal) {
        case 1: servoPolegar.detach();   pinPolegar = novoGpio;   servoPolegar.attach(pinPolegar, 500, 2400);   servoPolegar.write(posPolegar); break;
        case 2: servoIndicador.detach(); pinIndicador = novoGpio; servoIndicador.attach(pinIndicador, 500, 2400); servoIndicador.write(posIndicador); break;
        case 3: servoMedio.detach();     pinMedio = novoGpio;     servoMedio.attach(pinMedio, 500, 2400);     escreverServoMedio(posMedio); break;
        case 4: servoAnelar.detach();    pinAnelar = novoGpio;    servoAnelar.attach(pinAnelar, 500, 2400);    servoAnelar.write(posAnelar); break;
        case 5: servoMindinho.detach();  pinMindinho = novoGpio;  servoMindinho.attach(pinMindinho, 500, 2400);  servoMindinho.write(posMindinho); break;
        case 6: servoPulso.detach();     pinPulso = novoGpio;     servoPulso.attach(pinPulso, 500, 2400);     servoPulso.write(posPulso); break;
      }
      return;
    }
  }

  // 2. Formato Completo com Letra + 6 Ângulos do Site: "L:A:90,180,180,180,180,150"
  if (cmd.startsWith("L:")) {
    char letraChar = toupper(cmd.charAt(2));
    int segundoDoisPontos = cmd.indexOf(':', 2);
    if (segundoDoisPontos > 0) {
      String strAng = cmd.substring(segundoDoisPontos + 1);
      int p, i, m, a, mi, pu;
      if (sscanf(strAng.c_str(), "%d,%d,%d,%d,%d,%d", &p, &i, &m, &a, &mi, &pu) == 6) {
        aplicarAngulos(p, i, m, a, mi, pu);
        if (letraChar == 'H' || letraChar == 'J' || letraChar == 'K' || letraChar == 'X' || letraChar == 'Z') {
          delay(80);
          animarPulsoDinamico(letraChar, pu);
        }
        return;
      }
    }
    executarLetraTabela(letraChar);
    return;
  }

  // 3. Formato Direto de 6 Ângulos (Sliders em tempo real): "ANG:90,180,180,180,180,150"
  if (cmd.startsWith("ANG:")) {
    String strAng = cmd.substring(4);
    int p, i, m, a, mi, pu;
    if (sscanf(strAng.c_str(), "%d,%d,%d,%d,%d,%d", &p, &i, &m, &a, &mi, &pu) == 6) {
      aplicarAngulos(p, i, m, a, mi, pu);
      return;
    }
  }

  // 4. Teste Individual de Servo: "TEST:1:180" (Canal 1 a 6)
  if (cmd.startsWith("TEST:")) {
    int canal, ang;
    if (sscanf(cmd.c_str(), "TEST:%d:%d", &canal, &ang) == 2) {
      ang = travaSegura(ang);
      Serial.printf("[TESTE SERVO %d] -> %d°\n", canal, ang);
      switch (canal) {
        case 1: servoPolegar.write(ang);   posPolegar = ang; break;
        case 2: servoIndicador.write(ang); posIndicador = ang; break;
        case 3: escreverServoMedio(ang);   break;
        case 4: servoAnelar.write(ang);    posAnelar = ang; break;
        case 5: servoMindinho.write(ang);  posMindinho = ang; break;
        case 6: servoPulso.write(ang);     posPulso = ang; break;
      }
      return;
    }
  }

  // 5. Repouso: "REST" ou "REST:150"
  if (cmd.startsWith("REST") || cmd.startsWith("RESET") || cmd.equalsIgnoreCase("CMD_REPOUSO")) {
    int doisPontos = cmd.indexOf(':');
    if (doisPontos > 0) {
      int pu = cmd.substring(doisPontos + 1).toInt();
      aplicarRepouso(travaSegura(pu));
    } else {
      aplicarRepouso(PULSO_NEUTRO_PADRAO);
    }
    return;
  }

  // 6. "CMD_A" .. "CMD_Z"
  if (cmd.startsWith("CMD_") && cmd.length() >= 5) {
    executarLetraTabela(cmd.charAt(4));
    return;
  }

  // 7. Letra isolada "A" .. "Z"
  if (cmd.length() == 1 && isAlpha(cmd.charAt(0))) {
    executarLetraTabela(cmd.charAt(0));
    return;
  }
}

// ============================================================================
// 10. CALLBACKS BLE COM ACUMULADOR DE PACOTES
// ============================================================================
class ServidorCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    rxBufferAcumulador = "";
    digitalWrite(PIN_LED_STATUS, HIGH);
    Serial.println(">>> [BLE] Site conectado com sucesso!");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    rxBufferAcumulador = "";
    digitalWrite(PIN_LED_STATUS, LOW);
    Serial.println(">>> [BLE] Desconectado. Reiniciando publicidade...");
  }
};

class CaracteristicaCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String rx = pCharacteristic->getValue();
    if (rx.length() == 0) return;

    for (unsigned int i = 0; i < rx.length(); i++) {
      char c = rx.charAt(i);
      if (c == '<') {
        rxBufferAcumulador = "";
      } else if (c == '>' || c == '\n' || c == '\r') {
        if (rxBufferAcumulador.length() > 0) {
          enfileirarComandoBLE(rxBufferAcumulador);
          rxBufferAcumulador = "";
        }
      } else {
        if (rxBufferAcumulador.length() < 80) {
          rxBufferAcumulador += c;
        }
      }
    }

    if (rxBufferAcumulador.length() == 1 && isAlpha(rxBufferAcumulador.charAt(0)) && rx.indexOf('<') == -1) {
      enfileirarComandoBLE(rxBufferAcumulador);
      rxBufferAcumulador = "";
    }
  }
};

// ============================================================================
// 11. SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n========================================================");
  Serial.println("   LibraTronic ESP32 v8.0 — Pinagem & Médio Corrigidos  ");
  Serial.println("   Pol:12 | Ind:13 | Med:14(+33,32,15,4) | Ane:27 | Min:26 | Pul:25");
  Serial.println("========================================================\n");

  pinMode(PIN_LED_STATUS, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Libera os pinos JTAG (12, 13, 14, 15) como saídas digitais puras antes do PWM
  pinMode(pinPolegar, OUTPUT);
  pinMode(pinIndicador, OUTPUT);
  pinMode(pinMedio, OUTPUT);
  pinMode(pinAnelar, OUTPUT);
  pinMode(pinMindinho, OUTPUT);
  pinMode(pinPulso, OUTPUT);
  pinMode(PIN_MEDIO_ESPELHO_1, OUTPUT);
  pinMode(PIN_MEDIO_ESPELHO_2, OUTPUT);
  pinMode(PIN_MEDIO_ESPELHO_3, OUTPUT);
  pinMode(PIN_MEDIO_ESPELHO_4, OUTPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  servoPolegar.setPeriodHertz(50);
  servoIndicador.setPeriodHertz(50);
  servoMedio.setPeriodHertz(50);
  servoAnelar.setPeriodHertz(50);
  servoMindinho.setPeriodHertz(50);
  servoPulso.setPeriodHertz(50);

  servoMedioEspelho1.setPeriodHertz(50);
  servoMedioEspelho2.setPeriodHertz(50);
  servoMedioEspelho3.setPeriodHertz(50);
  servoMedioEspelho4.setPeriodHertz(50);

  // Attach com largura de pulso explícita (500us a 2400us) para máxima força e curso
  servoPolegar.attach(pinPolegar, 500, 2400);
  servoIndicador.attach(pinIndicador, 500, 2400);
  servoMedio.attach(pinMedio, 500, 2400);
  servoAnelar.attach(pinAnelar, 500, 2400);
  servoMindinho.attach(pinMindinho, 500, 2400);
  servoPulso.attach(pinPulso, 500, 2400);

  // Anexa espelhos do Dedo Médio nos pinos livres vizinhos (33, 32, 15, 4)
  servoMedioEspelho1.attach(PIN_MEDIO_ESPELHO_1, 500, 2400);
  servoMedioEspelho2.attach(PIN_MEDIO_ESPELHO_2, 500, 2400);
  servoMedioEspelho3.attach(PIN_MEDIO_ESPELHO_3, 500, 2400);
  servoMedioEspelho4.attach(PIN_MEDIO_ESPELHO_4, 500, 2400);

  aplicarRepouso(PULSO_NEUTRO_PADRAO);

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(128);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServidorCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  pCharacteristic->setCallbacks(new CaracteristicaCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("✓ BLE v8.0 Pronto! Aguardando conexão...\n");
}

// ============================================================================
// 12. LOOP PRINCIPAL
// ============================================================================
void loop() {
  String cmd;
  while (desenfileirarComandoBLE(cmd)) {
    processarComando(cmd);
  }

  if (Serial.available()) {
    String cmdSerial = Serial.readStringUntil('\n');
    processarComando(cmdSerial);
  }

  if (!deviceConnected && oldDeviceConnected) {
    delay(300);
    pServer->startAdvertising();
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  delay(5);
}
