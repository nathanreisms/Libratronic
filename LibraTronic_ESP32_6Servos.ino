// ============================================================================
// LibraTronic_ESP32_6Servos.ino — Firmware Oficial LibraTronic para ESP32
// Mão Biônica Biomimética 3D (5 Dedos + 1 Pulso = 6 Servomotores)
// Conexão Web Bluetooth BLE integrada ao site LibraTronic
//
// REQUISITO MECÂNICO OBRIGATÓRIO:
//   - Posição 90°  : Dedo reto (estendido / neutro)
//   - Posição 180° : Dedo completamente curvado (flexionado)
//   - NENHUM número menor que 90° é permitido!
//     (Valores < 90° forçam e travam os tendões mecânicos da mão 3D)
//
// CONEXÕES FÍSICAS RECOMENDADAS NO ESP32:
//   - Servo 1 (Polegar)   → GPIO 13
//   - Servo 2 (Indicador) → GPIO 12
//   - Servo 3 (Médio)     → GPIO 14
//   - Servo 4 (Anelar)    → GPIO 27
//   - Servo 5 (Mindinho)  → GPIO 26
//   - Servo 6 (Pulso)     → GPIO 25
//   - LED Onboard         → GPIO 2 (Sinaliza conexão BLE)
//   - GND comum entre ESP32 e fonte de alimentação externa de 5V dos servos.
//
// BIBLIOTECA NECESSÁRIA NO ARDUINO IDE:
//   - "ESP32Servo" por Kevin Harrington (Gerenciador de Bibliotecas)
// ============================================================================

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>

// ============================================================================
// 1. CONSTANTES BLE (IDÊNTICAS AO WEBSITE)
// ============================================================================
#define DEVICE_NAME         "LibraTronic"
#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"

// ============================================================================
// 2. PINAGEM DOS 6 SERVOMOTORES
// ============================================================================
#define PIN_SERVO_POLEGAR   13
#define PIN_SERVO_INDICADOR 12
#define PIN_SERVO_MEDIO     14
#define PIN_SERVO_ANELAR    27
#define PIN_SERVO_MINDINHO  26
#define PIN_SERVO_PULSO     25
#define PIN_LED_STATUS      2

// ============================================================================
// 3. LIMITES MECÂNICOS DE SEGURANÇA (REGRA INVIOLÁVEL: >= 90° e <= 180°)
// ============================================================================
#define ANGULO_MIN_RETO     90   // Dedo reto / aberto (NUNCA USAR < 90°)
#define ANGULO_MAX_CURVADO 180   // Dedo completamente curvado / fechado
#define VELOCIDADE_PASSO_MS  3   // Intervalo de interpolação suave (ms por grau)

// ============================================================================
// 4. OBJETOS DOS SERVOS E ESTADO ATUAL
// ============================================================================
Servo servoPolegar;
Servo servoIndicador;
Servo servoMedio;
Servo servoAnelar;
Servo servoMindinho;
Servo servoPulso;

// Posições atuais em memória (iniciam em repouso: 90° todos retos)
int posAtualPolegar   = 90;
int posAtualIndicador = 90;
int posAtualMedio     = 90;
int posAtualAnelar    = 90;
int posAtualMindinho  = 90;
int posAtualPulso     = 90;

// Objetos BLE
BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Buffer de recepção BLE
String bufferComando = "";
bool comandoPendente = false;

// ============================================================================
// 5. ESTRUTURA PARA AS POSES DAS LETRAS (6 SERVOS)
// ============================================================================
struct Pose6Servos {
  char letra;
  int polegar;
  int indicador;
  int medio;
  int anelar;
  int mindinho;
  int pulso;
};

// Tabela oficial com calibração precisa para a datilologia Libras A–Z
// Todos os valores de dedos estão rigorosamente em [90, 180]
const Pose6Servos TABELA_LETRAS[] = {
  { 'A',  90, 180, 180, 180, 180,  90 }, // Polegar encostado lateral, 4 dedos fechados
  { 'B', 180,  90,  90,  90,  90,  90 }, // 4 dedos estendidos retos, polegar na palma
  { 'C', 135, 135, 135, 135, 135,  90 }, // Todos os dedos em arco C
  { 'D', 175,  90, 180, 180, 180,  90 }, // Indicador reto, outros dedos tocam polegar
  { 'E', 180, 155, 155, 155, 155,  90 }, // Falanges em garra fechada
  { 'F', 120, 175,  90,  90,  90,  90 }, // Indicador flexionado com polegar por fora
  { 'G',  90,  90, 180, 180, 180,  90 }, // Indicador e polegar estendidos paralelos
  { 'H', 130,  90,  90, 180, 180, 140 }, // Indicador e médio retos com pulso inclinado
  { 'I', 180, 180, 180, 180,  90,  90 }, // Apenas mindinho estendido reto
  { 'J', 180, 180, 180, 180,  90, 145 }, // Mindinho reto com curva do J
  { 'K', 125,  90,  90, 180, 180, 115 }, // Indicador e médio retos, polegar entre eles
  { 'L',  90,  90, 180, 180, 180,  90 }, // L com indicador e polegar em 90 graus
  { 'M', 180, 150, 150, 150, 180, 120 }, // 3 dedos curvados apontando para baixo
  { 'N', 180, 150, 150, 180, 180, 120 }, // 2 dedos curvados apontando para baixo
  { 'O', 165, 165, 165, 165, 165,  90 }, // Círculo fechado O
  { 'P', 125,  90,  90, 180, 180, 155 }, // K apontando para baixo
  { 'Q',  90,  90, 180, 180, 180, 155 }, // G apontando para baixo
  { 'R', 180,  90,  90, 180, 180,  90 }, // Indicador e médio estendidos cruzados
  { 'S', 180, 180, 180, 180, 180,  90 }, // Punho completamente fechado
  { 'T', 135, 180,  90,  90,  90,  90 }, // Indicador flexionado com polegar por dentro
  { 'U', 180,  90,  90, 180, 180,  90 }, // Indicador e médio retos e colados
  { 'V', 180,  90,  90, 180, 180,  90 }, // Indicador e médio retos em V
  { 'W', 180,  90,  90,  90, 180,  90 }, // Três dedos retos e afastados
  { 'X', 140, 140, 180, 180, 180,  90 }, // Indicador em gancho
  { 'Y',  90, 180, 180, 180,  90,  90 }, // Polegar e mindinho retos (shaka)
  { 'Z', 180,  90, 180, 180, 180,  90 }  // Indicador reto traçando Z
};
const int TOTAL_LETRAS = sizeof(TABELA_LETRAS) / sizeof(TABELA_LETRAS[0]);

// ============================================================================
// 6. FUNÇÃO DE PROTEÇÃO MECÂNICA CONTRA ÂNGULOS < 90°
// ============================================================================
/**
 * Garante que NENHUM servo receba valor menor que 90 graus.
 * 90° = Dedo reto
 * 180° = Dedo curvado
 */
int sanitizarAnguloMao(int angulo) {
  if (angulo < ANGULO_MIN_RETO) {
    Serial.printf("[AVISO DE SEGURANCA] Angulo %d < 90 travado em 90 graus!\n", angulo);
    return ANGULO_MIN_RETO;
  }
  if (angulo > ANGULO_MAX_CURVADO) {
    return ANGULO_MAX_CURVADO;
  }
  return angulo;
}

// ============================================================================
// 7. CONTROLE SUAVE E SEGURO DOS SERVOS
// ============================================================================
void moverServosSuave(int alvoPol, int alvoInd, int alvoMed, int alvoAne, int alvoMin, int alvoPul) {
  // 1. Sanitização obrigatória de todos os 6 ângulos (NUNCA < 90°)
  alvoPol = sanitizarAnguloMao(alvoPol);
  alvoInd = sanitizarAnguloMao(alvoInd);
  alvoMed = sanitizarAnguloMao(alvoMed);
  alvoAne = sanitizarAnguloMao(alvoAne);
  alvoMin = sanitizarAnguloMao(alvoMin);
  alvoPul = sanitizarAnguloMao(alvoPul);

  Serial.printf("[MOVENDO] Pol:%d° | Ind:%d° | Med:%d° | Ane:%d° | Min:%d° | Pul:%d°\n",
                alvoPol, alvoInd, alvoMed, alvoAne, alvoMin, alvoPul);

  // 2. Interpolação passo a passo para movimentação suave dos tendões
  bool emMovimento = true;
  while (emMovimento) {
    emMovimento = false;

    if (posAtualPolegar != alvoPol) {
      posAtualPolegar += (alvoPol > posAtualPolegar) ? 1 : -1;
      servoPolegar.write(posAtualPolegar);
      emMovimento = true;
    }
    if (posAtualIndicador != alvoInd) {
      posAtualIndicador += (alvoInd > posAtualIndicador) ? 1 : -1;
      servoIndicador.write(posAtualIndicador);
      emMovimento = true;
    }
    if (posAtualMedio != alvoMed) {
      posAtualMedio += (alvoMed > posAtualMedio) ? 1 : -1;
      servoMedio.write(posAtualMedio);
      emMovimento = true;
    }
    if (posAtualAnelar != alvoAne) {
      posAtualAnelar += (alvoAne > posAtualAnelar) ? 1 : -1;
      servoAnelar.write(posAtualAnelar);
      emMovimento = true;
    }
    if (posAtualMindinho != alvoMin) {
      posAtualMindinho += (alvoMin > posAtualMindinho) ? 1 : -1;
      servoMindinho.write(posAtualMindinho);
      emMovimento = true;
    }
    if (posAtualPulso != alvoPul) {
      posAtualPulso += (alvoPul > posAtualPulso) ? 1 : -1;
      servoPulso.write(posAtualPulso);
      emMovimento = true;
    }

    if (emMovimento) {
      delay(VELOCIDADE_PASSO_MS);
    }
  }
}

// Coloca todos os 6 servos na posição neutra / mão aberta (90°)
void aplicarRepouso() {
  Serial.println("[LIBRATRONIC] Repouso: Mão aberta (todos em 90°)");
  moverServosSuave(90, 90, 90, 90, 90, 90);
}

// Procura a letra na tabela e aplica a pose correspondente
bool aplicarLetra(char letraChar) {
  letraChar = toupper(letraChar);
  for (int i = 0; i < TOTAL_LETRAS; i++) {
    if (TABELA_LETRAS[i].letra == letraChar) {
      Serial.printf("[LIBRATRONIC] Executando letra: %c\n", letraChar);
      moverServosSuave(
        TABELA_LETRAS[i].polegar,
        TABELA_LETRAS[i].indicador,
        TABELA_LETRAS[i].medio,
        TABELA_LETRAS[i].anelar,
        TABELA_LETRAS[i].mindinho,
        TABELA_LETRAS[i].pulso
      );
      return true;
    }
  }
  Serial.printf("[AVISO] Letra '%c' desconhecida!\n", letraChar);
  return false;
}

// ============================================================================
// 8. INTERPRETADOR DE PROTOCOLO BLE / SERIAL
// ============================================================================
void processarComando(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  // Remove delimitadores '<' e '>' se existirem
  if (cmd.startsWith("<") && cmd.endsWith(">")) {
    cmd = cmd.substring(1, cmd.length() - 1);
    cmd.trim();
  }

  Serial.printf("[BLE RECEBIDO] %s\n", cmd.c_str());

  // Formato 1: Pacote completo do bluetooth.js: "L:A:90,180,180,180,180,90"
  if (cmd.startsWith("L:")) {
    int primeiroDoisPontos = cmd.indexOf(':');
    int segundoDoisPontos  = cmd.indexOf(':', primeiroDoisPontos + 1);
    if (segundoDoisPontos > 0) {
      char letraChar = cmd.charAt(primeiroDoisPontos + 1);
      String strAngulos = cmd.substring(segundoDoisPontos + 1);

      int p, i, m, a, mi, pu;
      if (sscanf(strAngulos.c_str(), "%d,%d,%d,%d,%d,%d", &p, &i, &m, &a, &mi, &pu) == 6) {
        Serial.printf("[CMD L] Letra %c com angulos calibrados\n", letraChar);
        moverServosSuave(p, i, m, a, mi, pu);
        return;
      }
    }
  }

  // Formato 2: Ângulos manuais diretos: "ANG:90,180,180,180,180,90"
  if (cmd.startsWith("ANG:")) {
    String strAngulos = cmd.substring(4);
    int p, i, m, a, mi, pu;
    if (sscanf(strAngulos.c_str(), "%d,%d,%d,%d,%d,%d", &p, &i, &m, &a, &mi, &pu) >= 5) {
      if (pu < 90) pu = 90;
      moverServosSuave(p, i, m, a, mi, pu);
      return;
    }
  }

  // Formato 3: Comando de Repouso
  if (cmd.equalsIgnoreCase("REST") || cmd.equalsIgnoreCase("RESET") || cmd.equalsIgnoreCase("CMD_REPOUSO")) {
    aplicarRepouso();
    return;
  }

  // Formato 4: Letra simples ("A".."Z") ou "CMD_A"
  if (cmd.startsWith("CMD_") && cmd.length() == 5) {
    char letraChar = cmd.charAt(4);
    aplicarLetra(letraChar);
    return;
  }

  if (cmd.length() == 1 && isAlpha(cmd.charAt(0))) {
    aplicarLetra(cmd.charAt(0));
    return;
  }

  Serial.println("[AVISO] Formato de comando não reconhecido.");
}

// ============================================================================
// 9. CALLBACKS DO SERVIDOR BLE
// ============================================================================
class ServidorCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    digitalWrite(PIN_LED_STATUS, HIGH);
    Serial.println(">>> [BLE] Cliente conectado com sucesso!");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    digitalWrite(PIN_LED_STATUS, LOW);
    Serial.println(">>> [BLE] Cliente desconectado. Reiniciando publicidade...");
  }
};

class CaracteristicaCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String rxValue = pCharacteristic->getValue();
    if (rxValue.length() > 0) {
      bufferComando = rxValue;
      comandoPendente = true;
    }
  }
};

// ============================================================================
// 10. INICIALIZAÇÃO (SETUP)
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n========================================================");
  Serial.println("   LibraTronic ESP32 — Controlador de Mão Biônica 3D    ");
  Serial.println("   5 Dedos + 1 Pulso (6 Servomotores) · Web Bluetooth    ");
  Serial.println("   Regra de Seguranca: 90° (Reto) a 180° (Curvado)      ");
  Serial.println("========================================================\n");

  pinMode(PIN_LED_STATUS, OUTPUT);
  digitalWrite(PIN_LED_STATUS, LOW);

  // Alocação de temporizadores para a biblioteca ESP32Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  // Configuração padrão de frequência para servos analógicos SG90/MG90S (50Hz)
  servoPolegar.setPeriodHertz(50);
  servoIndicador.setPeriodHertz(50);
  servoMedio.setPeriodHertz(50);
  servoAnelar.setPeriodHertz(50);
  servoMindinho.setPeriodHertz(50);
  servoPulso.setPeriodHertz(50);

  // Conexão dos servos aos pinos GPIO (faixa padrão 500us a 2400us)
  servoPolegar.attach(PIN_SERVO_POLEGAR, 500, 2400);
  servoIndicador.attach(PIN_SERVO_INDICADOR, 500, 2400);
  servoMedio.attach(PIN_SERVO_MEDIO, 500, 2400);
  servoAnelar.attach(PIN_SERVO_ANELAR, 500, 2400);
  servoMindinho.attach(PIN_SERVO_MINDINHO, 500, 2400);
  servoPulso.attach(PIN_SERVO_PULSO, 500, 2400);

  // Inicia todos os servos na posição de repouso segura (90° em todos)
  aplicarRepouso();

  // Inicialização do Servidor Bluetooth BLE
  BLEDevice::init(DEVICE_NAME);
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

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("✓ Servidor BLE iniciado com sucesso!");
  Serial.printf("✓ Nome do dispositivo: \"%s\"\n", DEVICE_NAME);
  Serial.printf("✓ UUID do Servico   : %s\n", SERVICE_UUID);
  Serial.println("✓ Aguardando conexao do site LibraTronic...\n");
}

// ============================================================================
// 11. LOOP PRINCIPAL
// ============================================================================
void loop() {
  // Processa comandos vindos via BLE
  if (comandoPendente) {
    comandoPendente = false;
    processarComando(bufferComando);
  }

  // Também permite digitar comandos diretamente no Monitor Serial para testes!
  if (Serial.available()) {
    String cmdSerial = Serial.readStringUntil('\n');
    processarComando(cmdSerial);
  }

  // Gerenciamento de reconexão de publicidade BLE
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("[BLE] Publicidade reiniciada para nova busca.");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  delay(10);
}
