// ============================================================
// LibraTronic_ESP32.ino — Firmware v4.0 para ESP32
// Mão Robótica Biomimética para Tradução de Libras
// Integrado com: database.json · script.js · Web Bluetooth BLE
//
// Arquitetura:
//   - BLE Server com UUID de Serviço 0000FFE0 e Característica 0000FFE1
//     (compatível com o protocolo do website LibraTronic)
//   - 16 Servos (5 dedos × 3 falanges + 1 pulso) via PCA9685
//   - Conversão automática de rotações 3D (radianos) → ângulos de servo
//   - Suporte a letras A–Z, sinais compostos e movimentos dinâmicos
//   - Fila de comandos com processamento sequencial
//   - LED de status integrado
//
// Hardware necessário:
//   - ESP32 DevKit v1 (ou compatível)
//   - PCA9685 (driver PWM I2C de 16 canais para servos)
//   - Servos micro SG90 ou MG90S (×16)
//   - Alimentação externa 5V para os servos (não usar USB do ESP32)
//
// Conexões I2C (PCA9685):
//   SDA → GPIO 21
//   SCL → GPIO 22
//   VCC → 3.3V (lógica) + 5V externo (servos)
//   GND → GND comum
// ============================================================

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Wire.h>
#include <math.h>

// ============================================================
// 1. CONFIGURAÇÕES BLE (Compatíveis com o Website)
// ============================================================
#define DEVICE_NAME        "LibraTronic"
#define SERVICE_UUID       "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"

// ============================================================
// 2. CONFIGURAÇÕES DO PCA9685
// ============================================================
#define PCA9685_ADDR    0x40
#define PCA9685_MODE1   0x00
#define PCA9685_PRESCALE 0xFE
#define LED0_ON_L       0x06

// Frequência PWM para servos (50 Hz → período de 20ms)
#define SERVO_FREQ      50
// Limites de pulso do servo em contagens do PCA9685 (4096 ticks por período)
#define SERVO_MIN       102   // ~0.5ms  →   0°
#define SERVO_MAX       512   // ~2.5ms  → 180°

// ============================================================
// 3. MAPEAMENTO DOS CANAIS DE SERVO NO PCA9685
//    Cada dedo: 3 juntas (MCP = base, PIP = meio, DIP = ponta)
//    + 1 canal para o pulso (wrist)
// ============================================================
// --- Polegar ---
#define SERVO_POLEGAR_MCP   0
#define SERVO_POLEGAR_PIP   1
#define SERVO_POLEGAR_DIP   2  // (usado para rotação lateral Y/Z do polegar)

// --- Indicador ---
#define SERVO_INDICADOR_MCP 3
#define SERVO_INDICADOR_PIP 4
#define SERVO_INDICADOR_DIP 5

// --- Médio ---
#define SERVO_MEDIO_MCP     6
#define SERVO_MEDIO_PIP     7
#define SERVO_MEDIO_DIP     8

// --- Anelar ---
#define SERVO_ANELAR_MCP    9
#define SERVO_ANELAR_PIP   10
#define SERVO_ANELAR_DIP   11

// --- Mindinho ---
#define SERVO_MINDINHO_MCP 12
#define SERVO_MINDINHO_PIP 13
#define SERVO_MINDINHO_DIP 14

// --- Pulso ---
#define SERVO_PULSO        15

// ============================================================
// 4. CONSTANTES DE CINEMÁTICA E LIMITES DE SEGURANÇA
// ============================================================
// LIMITES DE PROTEÇÃO PARA OS FIOS DE PESCA (TENDÕES) E SERVOS:
// Nunca permite que o servo atinja 0° ou ângulos extremos,
// evitando arrebentar o fio de pesca, espanar engrenagens ou queimar o motor.
#define SERVO_ANGULO_MIN    25   // Limite MÍNIMO seguro (padrão: 25° — NUNCA vai a 0°)
#define SERVO_ANGULO_MAX    155  // Limite MÁXIMO seguro (padrão: 155° — evita esticar além da conta)
#define SERVO_NEUTRO        90   // Ângulo neutro (mão aberta com fio sem folga e sem tensão excessiva)

// Fator de conversão: rotação 3D (radianos no database.json) → graus de servo
// O database usa valores de 0.0 (aberto) até ~1.68 rad (totalmente fechado).
// Com o limite em 25°, o curso total útil é (90° - 25°) = 65°
// 65° / 1.68 rad ≈ 38.7 °/rad
#define RAD_TO_SERVO_FACTOR 38.7

// Velocidade de transição entre poses (ms por grau de diferença)
#define MS_PER_DEGREE       3
// Tempo mínimo de sustentação de uma pose (ms)
#define POSE_HOLD_MS        600
// Pausa entre letras na soletração (ms)
#define INTER_LETTER_MS     400

// LED de status
#define LED_PIN             2  // LED interno do ESP32 DevKit

// ============================================================
// 5. ESTADO GLOBAL
// ============================================================
BLEServer*         pServer          = nullptr;
BLECharacteristic* pCharacteristic  = nullptr;
bool               deviceConnected  = false;
bool               oldDeviceConnected = false;

// Buffer de comando recebido via BLE
String comandoRecebido = "";
bool   novoComando     = false;

// Posições atuais dos servos (em graus)
int servoAtual[16];

// ============================================================
// 6. ESTRUTURAS DE DADOS PARA POSES
// ============================================================

// Ângulos de servo para cada dedo: MCP, PIP, DIP
struct DedoAngulos {
    int mcp;
    int pip;
    int dip;
};

// Pose completa da mão (5 dedos + pulso)
struct PoseMao {
    DedoAngulos polegar;
    DedoAngulos indicador;
    DedoAngulos medio;
    DedoAngulos anelar;
    DedoAngulos mindinho;
    int         pulso;
};

// ============================================================
// 7. DRIVER PCA9685
// ============================================================
bool pca9685Conectado = false;

void pca9685Write(uint8_t reg, uint8_t val) {
    if (!pca9685Conectado) return;
    Wire.beginTransmission(PCA9685_ADDR);
    Wire.write(reg);
    Wire.write(val);
    Wire.endTransmission();
}

uint8_t pca9685Read(uint8_t reg) {
    if (!pca9685Conectado) return 0;
    Wire.beginTransmission(PCA9685_ADDR);
    Wire.write(reg);
    Wire.endTransmission();
    Wire.requestFrom((uint8_t)PCA9685_ADDR, (uint8_t)1);
    return Wire.read();
}

bool pca9685Begin() {
    Wire.begin(21, 22);    // SDA=GPIO 21, SCL=GPIO 22
    Wire.setClock(100000); // 100kHz (estável e tolerante com jumpers)
    Wire.setTimeOut(80);   // Timeout para nunca travar o ESP32 se faltar conexão

    // Testa se o PCA9685 responde no barramento I2C
    Wire.beginTransmission(PCA9685_ADDR);
    if (Wire.endTransmission() != 0) {
        return false;
    }

    pca9685Conectado = true;

    // Reset do PCA9685
    pca9685Write(PCA9685_MODE1, 0x80);
    delay(10);

    // Configura frequência PWM para 50Hz
    uint8_t prescale = (uint8_t)(round(25000000.0 / (4096.0 * SERVO_FREQ)) - 1);
    uint8_t oldMode = pca9685Read(PCA9685_MODE1);
    pca9685Write(PCA9685_MODE1, (oldMode & 0x7F) | 0x10); // Sleep
    pca9685Write(PCA9685_PRESCALE, prescale);
    pca9685Write(PCA9685_MODE1, oldMode);
    delay(5);
    pca9685Write(PCA9685_MODE1, oldMode | 0xA0); // Auto-increment + restart
    return true;
}

void setServoPWM(uint8_t canal, uint16_t on, uint16_t off) {
    if (!pca9685Conectado) return;
    Wire.beginTransmission(PCA9685_ADDR);
    Wire.write(LED0_ON_L + 4 * canal);
    Wire.write(on & 0xFF);
    Wire.write(on >> 8);
    Wire.write(off & 0xFF);
    Wire.write(off >> 8);
    Wire.endTransmission();
}

// Posiciona um servo no ângulo desejado protegendo os fios de pesca
void setServoAngle(uint8_t canal, int angulo) {
    // PROTEÇÃO ATIVA: Trava no limite seguro configurado (SERVO_ANGULO_MIN a SERVO_ANGULO_MAX)
    angulo = constrain(angulo, SERVO_ANGULO_MIN, SERVO_ANGULO_MAX);
    uint16_t pulso = map(angulo, 0, 180, SERVO_MIN, SERVO_MAX);
    setServoPWM(canal, 0, pulso);
    servoAtual[canal] = angulo;
}

// ============================================================
// 8. CONVERSÃO 3D → SERVO COM TRAVA DE SEGURANÇA
//    Converte as rotações do database.json (radianos) em ângulos
//    de servo para cada junta da mão robótica sem forçar os fios
// ============================================================

/**
 * Converte um valor de rotação em radianos (do database.json)
 * para um ângulo de servo em graus respeitando os limites dos fios.
 */
int radParaServo(float rad) {
    int angulo = SERVO_NEUTRO - (int)(rad * RAD_TO_SERVO_FACTOR);
    return constrain(angulo, SERVO_ANGULO_MIN, SERVO_ANGULO_MAX);
}

/**
 * Converte a rotação lateral (Y/Z) do polegar para ângulo de servo.
 */
int radParaServoPolegarLateral(float y, float z) {
    float combinado = sqrt(y * y + z * z);
    if (z < 0) combinado = -combinado; // Polegar aberto lateralmente
    int angulo = SERVO_NEUTRO + (int)(combinado * RAD_TO_SERVO_FACTOR);
    return constrain(angulo, SERVO_ANGULO_MIN, SERVO_ANGULO_MAX);
}

/**
 * Converte a rotação do pulso (wrist) para ângulo de servo.
 */
int radParaServoPulso(float x, float y) {
    float combinado = x * 0.7 + y * 0.3;
    int angulo = SERVO_NEUTRO - (int)(combinado * RAD_TO_SERVO_FACTOR);
    return constrain(angulo, SERVO_ANGULO_MIN, SERVO_ANGULO_MAX);
}

/**
 * Constrói uma PoseMao a partir dos dados do database.json (rotacoes3d).
 *
 * Estrutura esperada do database.json para cada dedo:
 *   { "x": MCP, "y": ..., "z": ..., "midX": PIP, "distX": DIP }
 *
 * Para o polegar:
 *   { "x": MCP, "y": abdução, "z": oposição, "midX": PIP }
 */
PoseMao construirPose(
    float pulsoX, float pulsoY,
    float polX, float polY, float polZ, float polMidX,
    float indX, float indMidX, float indDistX,
    float medX, float medMidX, float medDistX,
    float aneX, float aneMidX, float aneDistX,
    float minX, float minMidX, float minDistX
) {
    PoseMao pose;

    // Pulso
    pose.pulso = radParaServoPulso(pulsoX, pulsoY);

    // Polegar: MCP = flexão principal, PIP = midX, DIP = rotação lateral
    pose.polegar.mcp = radParaServo(polX);
    pose.polegar.pip = radParaServo(polMidX);
    pose.polegar.dip = radParaServoPolegarLateral(polY, polZ);

    // Indicador
    pose.indicador.mcp = radParaServo(indX);
    pose.indicador.pip = radParaServo(indMidX);
    pose.indicador.dip = radParaServo(indDistX);

    // Médio
    pose.medio.mcp = radParaServo(medX);
    pose.medio.pip = radParaServo(medMidX);
    pose.medio.dip = radParaServo(medDistX);

    // Anelar
    pose.anelar.mcp = radParaServo(aneX);
    pose.anelar.pip = radParaServo(aneMidX);
    pose.anelar.dip = radParaServo(aneDistX);

    // Mindinho
    pose.mindinho.mcp = radParaServo(minX);
    pose.mindinho.pip = radParaServo(minMidX);
    pose.mindinho.dip = radParaServo(minDistX);

    return pose;
}

// ============================================================
// 9. TABELA DE POSES — ALFABETO LIBRAS A-Z
//    Valores extraídos diretamente do database.json
// ============================================================

PoseMao obterPoseLetra(char letra) {
    switch (letra) {
        case 'A':
            // Punho fechado com polegar encostado na lateral do indicador
            return construirPose(
                0.0, 0.0,                             // pulso x, y
                0.12, 0.18, -0.20, 0.08,              // polegar x, y, z, midX
                1.60, 1.68, 1.32,                     // indicador x, midX, distX
                1.62, 1.68, 1.32,                     // medio
                1.62, 1.68, 1.32,                     // anelar
                1.60, 1.68, 1.32                      // mindinho
            );

        case 'B':
            // 4 dedos estendidos e unidos, polegar dobrado sobre a palma
            return construirPose(
                0.0, 0.0,
                0.88, -0.38, 0.44, 0.98,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02
            );

        case 'C':
            // Dedos semi-curvados formando arco C
            return construirPose(
                0.0, -0.52,
                0.58, -0.38, -0.62, 0.58,
                0.64, 0.88, 0.68,
                0.66, 0.90, 0.68,
                0.66, 0.90, 0.68,
                0.64, 0.86, 0.64
            );

        case 'D':
            // Indicador estendido, demais curvos tocando polegar
            return construirPose(
                0.0, -0.28,
                0.68, -0.32, -0.24, 0.58,
                0.02, 0.02, 0.02,
                1.16, 1.22, 0.92,
                1.26, 1.32, 0.96,
                1.32, 1.36, 1.02
            );

        case 'E':
            // Garra compacta, polegar recolhido abaixo
            return construirPose(
                0.0, 0.0,
                0.92, -0.32, 0.30, 0.98,
                0.42, 1.58, 1.38,
                0.42, 1.58, 1.38,
                0.42, 1.58, 1.38,
                0.42, 1.58, 1.38
            );

        case 'F':
            // Indicador flexionado com polegar, 3 dedos estendidos
            return construirPose(
                0.0, -0.12,
                0.46, -0.16, -0.32, 0.24,
                1.06, 0.96, 0.56,
                0.03, 0.03, 0.02,
                0.03, 0.03, 0.02,
                0.03, 0.03, 0.02
            );

        case 'G':
            // Indicador e polegar paralelos, demais fechados
            return construirPose(
                0.0, -0.35,
                0.14, 0.10, -0.24, 0.05,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'H':
            // Indicador e médio estendidos (pose base antes do giro)
            return construirPose(
                0.0, -0.40,
                0.45, -0.15, -0.25, 0.35,
                0.02, 0.02, 0.02,
                0.22, 0.10, 0.05,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'I':
            // Apenas mindinho estendido
            return construirPose(
                0.0, 0.0,
                0.72, -0.22, 0.16, 0.68,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                0.02, 0.02, 0.02
            );

        case 'J':
            // Pose em I (mindinho estendido) — movimento de traçar J
            return construirPose(
                0.04, -0.10,
                0.72, -0.22, 0.16, 0.68,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                0.02, 0.02, 0.02
            );

        case 'K':
            // Indicador vertical, médio inclinado, polegar entre eles
            return construirPose(
                -0.14, -0.25,
                0.36, -0.15, -0.22, 0.20,
                0.02, 0.02, 0.02,
                0.56, 0.15, 0.05,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'L':
            // Indicador estendido + polegar a 90° formando L
            return construirPose(
                0.0, 0.0,
                0.0, 0.22, -1.36, 0.0,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'M':
            // 3 dedos apontando para baixo sobre o polegar
            return construirPose(
                0.38, 0.0,
                0.86, -0.35, 0.35, 0.86,
                0.96, 0.44, 0.24,
                0.96, 0.44, 0.24,
                0.96, 0.44, 0.24,
                1.62, 1.68, 1.30
            );

        case 'N':
            // 2 dedos apontando para baixo sobre o polegar
            return construirPose(
                0.38, 0.0,
                0.86, -0.35, 0.25, 0.86,
                0.96, 0.44, 0.24,
                0.96, 0.44, 0.24,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'O':
            // Dedos curvados em círculo com polegar
            return construirPose(
                0.0, -0.48,
                0.74, -0.42, -0.40, 0.72,
                0.96, 1.16, 0.86,
                0.98, 1.18, 0.86,
                0.96, 1.16, 0.86,
                0.92, 1.12, 0.82
            );

        case 'P':
            // Configuração de K inclinada na horizontal
            return construirPose(
                0.96, -0.35,
                0.36, -0.15, -0.22, 0.20,
                0.02, 0.02, 0.02,
                0.65, 0.15, 0.05,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'Q':
            // Configuração de G com pulso fletido para baixo
            return construirPose(
                1.18, 0.0,
                0.20, 0.10, -0.25, 0.05,
                0.15, 0.05, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'R':
            // Indicador e médio cruzados
            return construirPose(
                0.0, 0.0,
                0.85, -0.25, 0.25, 0.80,
                0.08, 0.05, 0.05,
                -0.04, 0.12, 0.08,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'S':
            // Punho fechado, polegar cruzado à frente dos dedos
            return construirPose(
                0.0, 0.0,
                0.78, -0.36, 0.30, 0.88,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'T':
            // Indicador flexionado por dentro do polegar
            return construirPose(
                0.0, -0.10,
                0.56, -0.10, -0.08, 0.26,
                1.12, 1.06, 0.66,
                0.03, 0.03, 0.02,
                0.03, 0.03, 0.02,
                0.03, 0.03, 0.02
            );

        case 'U':
            // Indicador e médio estendidos e unidos
            return construirPose(
                0.0, 0.0,
                0.86, -0.26, 0.26, 0.86,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'V':
            // Indicador e médio estendidos e afastados em V
            return construirPose(
                0.0, 0.0,
                0.86, -0.26, 0.26, 0.86,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'W':
            // 3 dedos estendidos e afastados em W
            return construirPose(
                0.0, 0.0,
                0.86, -0.26, 0.30, 0.86,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30
            );

        case 'X':
            // Indicador curvado em gancho
            return construirPose(
                0.0, -0.35,
                0.72, -0.20, 0.15, 0.66,
                0.24, 1.48, 1.28,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        case 'Y':
            // Polegar e mindinho estendidos, demais fechados
            return construirPose(
                0.0, 0.0,
                0.0, 0.22, -1.36, 0.0,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                0.02, 0.02, 0.02
            );

        case 'Z':
            // Indicador estendido (pose base para traçar Z)
            return construirPose(
                0.08, 0.0,
                0.76, -0.25, 0.20, 0.76,
                0.02, 0.02, 0.02,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30,
                1.62, 1.68, 1.30
            );

        default:
            // Pose neutra (mão aberta)
            return obterPoseNeutra();
    }
}

// ============================================================
// 10. POSES ESPECIAIS
// ============================================================

PoseMao obterPoseNeutra() {
    PoseMao pose;
    pose.pulso = SERVO_NEUTRO;
    pose.polegar   = {SERVO_NEUTRO, SERVO_NEUTRO, SERVO_NEUTRO};
    pose.indicador = {SERVO_NEUTRO, SERVO_NEUTRO, SERVO_NEUTRO};
    pose.medio     = {SERVO_NEUTRO, SERVO_NEUTRO, SERVO_NEUTRO};
    pose.anelar    = {SERVO_NEUTRO, SERVO_NEUTRO, SERVO_NEUTRO};
    pose.mindinho  = {SERVO_NEUTRO, SERVO_NEUTRO, SERVO_NEUTRO};
    return pose;
}

PoseMao obterPoseRepouso() {
    // Mão levemente relaxada (dedos parcialmente fechados)
    PoseMao pose;
    pose.pulso = SERVO_NEUTRO;
    pose.polegar   = {70, 75, SERVO_NEUTRO};
    pose.indicador = {75, 80, 85};
    pose.medio     = {75, 80, 85};
    pose.anelar    = {75, 80, 85};
    pose.mindinho  = {75, 80, 85};
    return pose;
}

// Poses para sinais compostos (palavras)
PoseMao obterPosePalavra(const String& palavra) {
    if (palavra == "AJUDA") {
        // Mão aberta com dedos estendidos
        return construirPose(
            0.22, -0.28,
            0.12, 0.16, -0.22, 0.10,
            0.04, 0.04, 0.04,
            0.04, 0.04, 0.04,
            0.04, 0.04, 0.04,
            0.04, 0.04, 0.04
        );
    }
    else if (palavra == "OBRIGADO") {
        // Mão em B partindo da testa
        return construirPose(
            0.32, 0.0,
            0.85, -0.35, 0.42, 0.95,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02
        );
    }
    else if (palavra == "AGUA") {
        // Configuração em L: polegar no queixo + indicador estendido
        return construirPose(
            0.0, -0.45,
            0.0, 0.20, -1.35, 0.0,
            0.05, 0.05, 0.02,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30
        );
    }
    else if (palavra == "BANHEIRO") {
        // Sinal de banheiro com oscilação do pulso
        return construirPose(
            0.15, 0.0,
            0.55, -0.10, -0.10, 0.25,
            1.10, 1.05, 0.65,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30
        );
    }
    else if (palavra == "SOCORRO") {
        // Mão aberta acenando
        return construirPose(
            0.0, 0.0,
            0.0, 0.15, -1.15, 0.0,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02,
            0.02, 0.02, 0.02
        );
    }
    else if (palavra == "COMIDA") {
        // Dedos em pinça levando à boca
        return construirPose(
            -0.35, -0.45,
            0.65, -0.35, -0.38, 0.55,
            0.85, 0.65, 0.35,
            0.88, 0.68, 0.35,
            0.85, 0.65, 0.35,
            0.80, 0.60, 0.30
        );
    }
    else if (palavra == "PERIGO") {
        // Configuração em Y com alerta
        return construirPose(
            0.0, -0.20,
            0.0, 0.20, -1.35, 0.0,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            0.02, 0.02, 0.02
        );
    }
    else if (palavra == "PORFAVOR") {
        // Mão aberta em B com movimento circular
        return construirPose(
            0.15, 0.35,
            0.0, 0.15, -1.10, 0.0,
            0.04, 0.04, 0.02,
            0.04, 0.04, 0.02,
            0.04, 0.04, 0.02,
            0.04, 0.04, 0.02
        );
    }
    else if (palavra == "SIM") {
        // Punho fechado em S para aceno afirmativo
        return construirPose(
            0.28, 0.0,
            0.78, -0.36, 0.30, 0.88,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30,
            1.62, 1.68, 1.30
        );
    }
    else if (palavra == "NAO") {
        // Indicador estendido para abanar negativo
        return construirPose(
            0.0, 0.0,
            0.65, -0.30, -0.20, 0.55,
            0.02, 0.02, 0.02,
            1.56, 1.62, 1.24,
            1.58, 1.64, 1.26,
            1.62, 1.68, 1.30
        );
    }

    // Fallback: pose neutra
    return obterPoseNeutra();
}

// ============================================================
// 11. APLICAÇÃO SUAVE DE POSES (Interpolação Linear nos Servos)
// ============================================================

// Aplica a pose movendo cada servo gradualmente
void aplicarPose(PoseMao& pose, int velocidade_ms = MS_PER_DEGREE) {
    // Array de destinos: canal → ângulo desejado
    int destino[16];
    destino[SERVO_POLEGAR_MCP]   = pose.polegar.mcp;
    destino[SERVO_POLEGAR_PIP]   = pose.polegar.pip;
    destino[SERVO_POLEGAR_DIP]   = pose.polegar.dip;
    destino[SERVO_INDICADOR_MCP] = pose.indicador.mcp;
    destino[SERVO_INDICADOR_PIP] = pose.indicador.pip;
    destino[SERVO_INDICADOR_DIP] = pose.indicador.dip;
    destino[SERVO_MEDIO_MCP]     = pose.medio.mcp;
    destino[SERVO_MEDIO_PIP]     = pose.medio.pip;
    destino[SERVO_MEDIO_DIP]     = pose.medio.dip;
    destino[SERVO_ANELAR_MCP]    = pose.anelar.mcp;
    destino[SERVO_ANELAR_PIP]    = pose.anelar.pip;
    destino[SERVO_ANELAR_DIP]    = pose.anelar.dip;
    destino[SERVO_MINDINHO_MCP]  = pose.mindinho.mcp;
    destino[SERVO_MINDINHO_PIP]  = pose.mindinho.pip;
    destino[SERVO_MINDINHO_DIP]  = pose.mindinho.dip;
    destino[SERVO_PULSO]         = pose.pulso;

    // Calcula o maior delta para definir a duração total
    int maxDelta = 0;
    for (int i = 0; i < 16; i++) {
        int delta = abs(destino[i] - servoAtual[i]);
        if (delta > maxDelta) maxDelta = delta;
    }

    if (maxDelta == 0) return;

    int totalMs = maxDelta * velocidade_ms;
    int steps = totalMs / 10; // Atualiza a cada 10ms
    if (steps < 1) steps = 1;

    int inicio[16];
    for (int i = 0; i < 16; i++) {
        inicio[i] = servoAtual[i];
    }

    for (int step = 1; step <= steps; step++) {
        float t = (float)step / (float)steps;
        // Easing suave: ease-in-out quadrático
        float eased = t < 0.5f ? 2.0f * t * t : 1.0f - pow(-2.0f * t + 2.0f, 2) / 2.0f;

        for (int i = 0; i < 16; i++) {
            int ang = inicio[i] + (int)((destino[i] - inicio[i]) * eased);
            setServoAngle(i, ang);
        }
        delay(10);
    }

    // Garante posição final exata
    for (int i = 0; i < 16; i++) {
        setServoAngle(i, destino[i]);
    }
}

// ============================================================
// 12. MOVIMENTOS DINÂMICOS (J, Z, H, K, X e sinais compostos)
// ============================================================

// Simula o traçado da letra J: descida vertical + curva com o mindinho
void executarMovimentoJ() {
    PoseMao poseI = obterPoseLetra('I'); // J começa na pose de I
    aplicarPose(poseI);
    delay(300);

    // Descida (rotação do pulso para baixo)
    PoseMao descida = poseI;
    descida.pulso = radParaServoPulso(0.6, -0.10);
    aplicarPose(descida, 4);
    delay(200);

    // Curva (rotação lateral do pulso)
    PoseMao curva = descida;
    curva.pulso = radParaServoPulso(0.8, -0.40);
    aplicarPose(curva, 5);
    delay(200);

    // Volta parcial (finalização do gancho do J)
    PoseMao gancho = curva;
    gancho.pulso = radParaServoPulso(0.5, -0.60);
    aplicarPose(gancho, 4);
    delay(300);
}

// Simula o traçado da letra Z: 3 retas em zigue-zague
void executarMovimentoZ() {
    PoseMao poseD = obterPoseLetra('Z'); // Z começa com indicador estendido
    aplicarPose(poseD);
    delay(300);

    // Reta 1: horizontal da esquerda para direita
    PoseMao reta1 = poseD;
    reta1.pulso = radParaServoPulso(0.08, -0.50);
    aplicarPose(reta1, 4);
    delay(250);

    // Reta 2: diagonal da direita para esquerda e para baixo
    PoseMao reta2 = reta1;
    reta2.pulso = radParaServoPulso(0.50, 0.30);
    aplicarPose(reta2, 4);
    delay(250);

    // Reta 3: horizontal da esquerda para direita novamente
    PoseMao reta3 = reta2;
    reta3.pulso = radParaServoPulso(0.50, -0.50);
    aplicarPose(reta3, 4);
    delay(300);
}

// Giro de pulso para a letra H
void executarMovimentoH() {
    PoseMao poseH = obterPoseLetra('H');
    aplicarPose(poseH);
    delay(300);

    // Giro horário do pulso
    PoseMao giro1 = poseH;
    giro1.pulso = radParaServoPulso(0.0, -0.80);
    aplicarPose(giro1, 3);
    delay(200);

    // Giro anti-horário
    PoseMao giro2 = poseH;
    giro2.pulso = radParaServoPulso(0.0, 0.40);
    aplicarPose(giro2, 3);
    delay(200);

    // Volta à posição central
    aplicarPose(poseH, 3);
    delay(200);
}

// Impulso para cima da letra K
void executarMovimentoK() {
    PoseMao poseK = obterPoseLetra('K');
    aplicarPose(poseK);
    delay(300);

    // Impulso para cima
    PoseMao impulso = poseK;
    impulso.pulso = radParaServoPulso(-0.50, -0.25);
    aplicarPose(impulso, 3);
    delay(250);

    // Volta
    aplicarPose(poseK, 3);
    delay(200);
}

// Puxar horizontal da letra X
void executarMovimentoX() {
    PoseMao poseX = obterPoseLetra('X');
    aplicarPose(poseX);
    delay(300);

    // Puxar para trás (flexão do indicador em gancho)
    PoseMao puxar = poseX;
    puxar.indicador.pip = radParaServo(1.68);
    puxar.indicador.dip = radParaServo(1.50);
    aplicarPose(puxar, 4);
    delay(200);

    // Volta
    aplicarPose(poseX, 4);
    delay(200);
}

// Oscilação lateral do pulso (BANHEIRO)
void executarOscilacaoPulso() {
    PoseMao pose = obterPosePalavra("BANHEIRO");
    aplicarPose(pose);
    delay(200);

    for (int i = 0; i < 3; i++) {
        PoseMao esq = pose;
        esq.pulso = radParaServoPulso(0.15, 0.40);
        aplicarPose(esq, 2);
        delay(150);

        PoseMao dir = pose;
        dir.pulso = radParaServoPulso(0.15, -0.40);
        aplicarPose(dir, 2);
        delay(150);
    }
    aplicarPose(pose, 3);
}

// Aceno afirmativo (SIM)
void executarAcenoSim() {
    PoseMao pose = obterPosePalavra("SIM");
    aplicarPose(pose);
    delay(200);

    for (int i = 0; i < 3; i++) {
        PoseMao cima = pose;
        cima.pulso = radParaServoPulso(-0.20, 0.0);
        aplicarPose(cima, 2);
        delay(150);

        PoseMao baixo = pose;
        baixo.pulso = radParaServoPulso(0.60, 0.0);
        aplicarPose(baixo, 2);
        delay(150);
    }
    aplicarPose(pose, 3);
}

// Abanar negativo (NÃO)
void executarAbanoNao() {
    PoseMao pose = obterPosePalavra("NAO");
    aplicarPose(pose);
    delay(200);

    for (int i = 0; i < 3; i++) {
        PoseMao esq = pose;
        esq.pulso = radParaServoPulso(0.0, 0.50);
        aplicarPose(esq, 2);
        delay(150);

        PoseMao dir = pose;
        dir.pulso = radParaServoPulso(0.0, -0.50);
        aplicarPose(dir, 2);
        delay(150);
    }
    aplicarPose(pose, 3);
}

// Movimento de ÁGUA: indicador flexiona 2 vezes
void executarMovimentoAgua() {
    PoseMao pose = obterPosePalavra("AGUA");
    aplicarPose(pose);
    delay(300);

    for (int i = 0; i < 2; i++) {
        // Flexiona indicador
        PoseMao flex = pose;
        flex.indicador.mcp = radParaServo(0.80);
        flex.indicador.pip = radParaServo(0.80);
        aplicarPose(flex, 3);
        delay(200);

        // Estende indicador
        aplicarPose(pose, 3);
        delay(200);
    }
}

// Movimento de OBRIGADO: arco para frente
void executarMovimentoObrigado() {
    PoseMao pose = obterPosePalavra("OBRIGADO");
    aplicarPose(pose);
    delay(300);

    // Arco para frente (flexão do pulso)
    PoseMao arco = pose;
    arco.pulso = radParaServoPulso(0.80, 0.0);
    aplicarPose(arco, 4);
    delay(400);

    // Volta parcial
    PoseMao volta = pose;
    volta.pulso = radParaServoPulso(0.50, 0.0);
    aplicarPose(volta, 3);
    delay(300);
}

// Movimento circular no peito (POR FAVOR)
void executarMovimentoPorFavor() {
    PoseMao pose = obterPosePalavra("PORFAVOR");
    aplicarPose(pose);
    delay(300);

    // Simula movimento circular com variações de pulso
    float angulos[] = {0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.28};
    for (int i = 0; i < 13; i++) {
        float a = angulos[i];
        PoseMao circular = pose;
        circular.pulso = radParaServoPulso(
            0.15 + 0.20 * sin(a),
            0.35 + 0.20 * cos(a)
        );
        aplicarPose(circular, 2);
        delay(80);
    }
    aplicarPose(pose, 3);
}

// Movimento de COMIDA: pinça levando à boca
void executarMovimentoComida() {
    PoseMao pose = obterPosePalavra("COMIDA");
    aplicarPose(pose);
    delay(300);

    for (int i = 0; i < 2; i++) {
        // Move para frente (à boca)
        PoseMao frente = pose;
        frente.pulso = radParaServoPulso(-0.60, -0.45);
        aplicarPose(frente, 3);
        delay(250);

        // Volta
        aplicarPose(pose, 3);
        delay(250);
    }
}

// Alerta duplo (SOCORRO)
void executarAlertaSocorro() {
    PoseMao pose = obterPosePalavra("SOCORRO");
    aplicarPose(pose);
    delay(200);

    for (int i = 0; i < 4; i++) {
        PoseMao esq = pose;
        esq.pulso = radParaServoPulso(0.0, 0.60);
        aplicarPose(esq, 2);
        delay(120);

        PoseMao dir = pose;
        dir.pulso = radParaServoPulso(0.0, -0.60);
        aplicarPose(dir, 2);
        delay(120);
    }
    aplicarPose(pose, 3);
}

// Alerta de PERIGO
void executarAlertaPerigo() {
    PoseMao pose = obterPosePalavra("PERIGO");
    aplicarPose(pose);
    delay(200);

    for (int i = 0; i < 3; i++) {
        PoseMao cima = pose;
        cima.pulso = radParaServoPulso(-0.30, -0.20);
        aplicarPose(cima, 2);
        delay(150);

        PoseMao baixo = pose;
        baixo.pulso = radParaServoPulso(0.20, -0.20);
        aplicarPose(baixo, 2);
        delay(150);
    }
    aplicarPose(pose, 3);
}

// AJUDA: impulso para frente
void executarMovimentoAjuda() {
    PoseMao pose = obterPosePalavra("AJUDA");
    aplicarPose(pose);
    delay(300);

    PoseMao frente = pose;
    frente.pulso = radParaServoPulso(0.50, -0.28);
    aplicarPose(frente, 4);
    delay(400);

    aplicarPose(pose, 3);
    delay(200);
}

// ============================================================
// 13. PROCESSADOR DE COMANDOS BLE
// ============================================================

void processarComando(String cmd) {
    cmd.trim();
    cmd.toUpperCase();

    Serial.print("[BLE] Comando recebido: ");
    Serial.println(cmd);

    // Pisca LED para indicar recebimento
    digitalWrite(LED_PIN, HIGH);

    // ── Comando de repouso/espaço ──
    if (cmd == "CMD_REPOUSO") {
        PoseMao repouso = obterPoseRepouso();
        aplicarPose(repouso);
        delay(POSE_HOLD_MS);
    }
    else if (cmd == "CMD_ESPACO") {
        PoseMao neutra = obterPoseNeutra();
        aplicarPose(neutra);
        delay(400);
    }

    // ── Letras A-Z (CMD_A ... CMD_Z) ──
    else if (cmd.startsWith("CMD_") && cmd.length() == 5) {
        char letra = cmd.charAt(4);
        if (letra >= 'A' && letra <= 'Z') {
            // Verifica se a letra tem movimento dinâmico
            switch (letra) {
                case 'H':
                    executarMovimentoH();
                    break;
                case 'J':
                    executarMovimentoJ();
                    break;
                case 'K':
                    executarMovimentoK();
                    break;
                case 'X':
                    executarMovimentoX();
                    break;
                case 'Z':
                    executarMovimentoZ();
                    break;
                default: {
                    // Letra estática: aplica a pose e sustenta
                    PoseMao pose = obterPoseLetra(letra);
                    aplicarPose(pose);
                    delay(POSE_HOLD_MS);
                    break;
                }
            }
        }
    }

    // ── Sinais compostos (palavras) ──
    else if (cmd == "CMD_AJUDA") {
        executarMovimentoAjuda();
    }
    else if (cmd == "CMD_OBRIGADO") {
        executarMovimentoObrigado();
    }
    else if (cmd == "CMD_AGUA") {
        executarMovimentoAgua();
    }
    else if (cmd == "CMD_BANHEIRO") {
        executarOscilacaoPulso();
    }
    else if (cmd == "CMD_SOCORRO") {
        executarAlertaSocorro();
    }
    else if (cmd == "CMD_COMIDA") {
        executarMovimentoComida();
    }
    else if (cmd == "CMD_PERIGO") {
        executarAlertaPerigo();
    }
    else if (cmd == "CMD_PORFAVOR") {
        executarMovimentoPorFavor();
    }
    else if (cmd == "CMD_SIM") {
        executarAcenoSim();
    }
    else if (cmd == "CMD_NAO") {
        executarAbanoNao();
    }

    else {
        Serial.print("[BLE] Comando desconhecido: ");
        Serial.println(cmd);
    }

    digitalWrite(LED_PIN, LOW);
}

// ============================================================
// 14. CALLBACKS BLE
// ============================================================

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        deviceConnected = true;
        Serial.println("[BLE] Dispositivo conectado!");
        digitalWrite(LED_PIN, HIGH);
        delay(200);
        digitalWrite(LED_PIN, LOW);
    }

    void onDisconnect(BLEServer* pServer) override {
        deviceConnected = false;
        Serial.println("[BLE] Dispositivo desconectado!");

        // Volta ao repouso quando desconecta
        PoseMao repouso = obterPoseRepouso();
        aplicarPose(repouso);

        // Reinicia advertising para permitir nova conexão
        delay(500);
        pServer->startAdvertising();
        Serial.println("[BLE] Advertising reiniciado — aguardando conexão...");
    }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) override {
        String valor = pCharacteristic->getValue().c_str();
        if (valor.length() > 0) {
            // O website envia comandos no formato <CMD_LETRA> ou <CMD_GESTO>
            // Remove os delimitadores < e >
            String cmd = "";
            for (int i = 0; i < (int)valor.length(); i++) {
                char c = valor.charAt(i);
                if (c != '<' && c != '>') {
                    cmd += c;
                }
            }
            if (cmd.length() > 0) {
                comandoRecebido = cmd;
                novoComando = true;
            }
        }
    }
};

// ============================================================
// 15. SETUP — Inicialização do Sistema
// ============================================================
void setup() {
    Serial.begin(115200);
    Serial.println();
    Serial.println("============================================");
    Serial.println("  LibraTronic ESP32 — Firmware v4.0");
    Serial.println("  Mão Robótica Biomimética para Libras");
    Serial.println("============================================");

    // LED de status
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH); // Liga o LED durante o boot

    // ── 1. INICIALIZA BLUETOOTH BLE PRIMEIRO (Emissão de sinal imediata) ──
    Serial.print("[INIT] Inicializando Bluetooth BLE (LibraTronic)...");
    BLEDevice::init(DEVICE_NAME);

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    BLEService* pService = pServer->createService(SERVICE_UUID);

    pCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ   |
        BLECharacteristic::PROPERTY_WRITE  |
        BLECharacteristic::PROPERTY_WRITE_NR |
        BLECharacteristic::PROPERTY_NOTIFY
    );

    pCharacteristic->addDescriptor(new BLE2902());
    pCharacteristic->setCallbacks(new CharacteristicCallbacks());

    pService->start();

    // Configuração robusta de Advertising (compatível com Windows 10/11, Chrome, Android, Mac)
    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06); // Ajuda na descoberta rápida
    pAdvertising->setMinPreferred(0x12);

    BLEAdvertisementData advData;
    advData.setName(DEVICE_NAME);
    advData.setCompleteServices(BLEUUID(SERVICE_UUID));
    pAdvertising->setAdvertisementData(advData);

    BLEAdvertisementData scanData;
    scanData.setName(DEVICE_NAME);
    pAdvertising->setScanResponseData(scanData);

    BLEDevice::startAdvertising();

    Serial.println(" OK!");
    Serial.println(" -> SINAL BLUETOOTH ATIVO E TRANSMITINDO!");
    Serial.print("    Nome do Dispositivo: "); Serial.println(DEVICE_NAME);
    Serial.print("    Serviço BLE UUID:    "); Serial.println(SERVICE_UUID);

    // ── 2. INICIALIZA O DRIVER DE SERVOS PCA9685 ──
    Serial.print("[INIT] Conectando ao PCA9685...");
    if (pca9685Begin()) {
        Serial.println(" OK! Módulo de servos detectado.");
        // Posiciona todos os servos no ângulo neutro (90°) com segurança
        for (int i = 0; i < 16; i++) {
            servoAtual[i] = SERVO_NEUTRO;
            setServoAngle(i, SERVO_NEUTRO);
            delay(15);
        }
        delay(300);
        PoseMao repouso = obterPoseRepouso();
        aplicarPose(repouso, 4);
        Serial.println("[INIT] Servos calibrados e em repouso.");
    } else {
        Serial.println(" [AVISO] PCA9685 não respondeu no endereço 0x40.");
        Serial.println("         (O sinal Bluetooth continuará transmitindo normalmente!)");
    }

    Serial.println();
    Serial.println("============================================");
    Serial.println("  SISTEMA PRONTO! Abra o site e clique em");
    Serial.println("  'Conectar Hardware' no navegador.");
    Serial.println("============================================");

    // Pisca LED 3 vezes indicando que está transmitindo BLE
    for (int i = 0; i < 3; i++) {
        digitalWrite(LED_PIN, LOW);
        delay(120);
        digitalWrite(LED_PIN, HIGH);
        delay(120);
    }
    digitalWrite(LED_PIN, LOW);
}

// ============================================================
// 16. LOOP PRINCIPAL
// ============================================================
void loop() {
    // Processa comandos recebidos via BLE
    if (novoComando) {
        novoComando = false;
        processarComando(comandoRecebido);
        comandoRecebido = "";
    }

    // Detecta mudança de estado de conexão
    if (!deviceConnected && oldDeviceConnected) {
        delay(500);
        oldDeviceConnected = deviceConnected;
    }
    if (deviceConnected && !oldDeviceConnected) {
        oldDeviceConnected = deviceConnected;
    }

    // LED pisca lentamente quando aguardando conexão
    if (!deviceConnected) {
        static unsigned long ultimoPisca = 0;
        static bool ledEstado = false;
        if (millis() - ultimoPisca > 2000) {
            ultimoPisca = millis();
            ledEstado = !ledEstado;
            digitalWrite(LED_PIN, ledEstado ? HIGH : LOW);
        }
    }

    delay(10); // Yield para o BLE stack
}
