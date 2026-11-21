// Uno #1: robot arm. Gets "S,b,sh,e,wp,wr,gr\n" from Uno #2 (velocity -100..100),
// moves 6 servos through the PCA9685. It refuses to move until CONFIG is filled in.
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <SoftwareSerial.h>
#include <EEPROM.h>

// ===================== CONFIG: EDIT THESE =====================
// field order = app order: base, shoulder, elbow, wrist-pitch, wrist-roll, gripper
// -1 means "not set yet" -> the arm will NOT move and prints ERR,CAL
const int  ANG_MIN[6]  = {-1, -1, -1, -1, -1, -1};   // lowest safe angle, found with calib tool
const int  ANG_MAX[6]  = {-1, -1, -1, -1, -1, -1};   // highest safe angle
const int  ANG_HOME[6] = {-1, -1, -1, -1, -1, -1};   // rest pose (between min and max)
// PCA9685 channel of each field. ASSUMED from the wiring diagram, check by testing
const byte CH[6]       = {5, 4, 3, 1, 2, 0};
const bool INVERT[6]   = {false, false, false, false, false, false};
const float SPEED_DPS[6] = {30, 30, 30, 45, 45, 60}; // deg/s at full stick. ASSUMED, slow on purpose
const int  US_MIN[6]   = {600, 600, 600, 600, 600, 600};   // pulse at 0 deg. ASSUMED
const int  US_MAX[6]   = {2400, 2400, 2400, 2400, 2400, 2400}; // pulse at 180 deg. ASSUMED
// ==============================================================

// Teach & Replay: two push buttons, each between the pin and GND
//   BTN_SAVE (D2): short press = save the current pose (up to MAX_POSES), hold 2 s = erase all
//   BTN_PLAY (D3): short press = play the saved poses once, press again = stop
const byte BTN_SAVE = 2, BTN_PLAY = 3, LED = 13;
const byte MAX_POSES = 8;
const unsigned long HOLD_MS = 2000, PAUSE_MS = 600;   // hold-to-erase time, pause on each pose

const byte LINK_RX = 8, LINK_TX = 9;     // Uno#2 A1 -> D8, D9 -> Uno#2 A0
const unsigned long WATCHDOG_MS = 500;   // no frame for this long = stop
const int DEADBAND = 5;                  // ignore tiny stick values

SoftwareSerial link(LINK_RX, LINK_TX);
Adafruit_PWMServoDriver pwm;

float angle[6];
int   vel[6] = {0, 0, 0, 0, 0, 0};
bool  configOk = false, armed = false, homing = false;
unsigned long lastFrame = 0, lastTick = 0, lastErr = 0;
char buf[48];
byte n = 0;
byte poses[MAX_POSES][6];            // saved angles (0..180 fit in a byte)
byte poseCount = 0, playIdx = 0;
bool playing = false;
unsigned long pauseUntil = 0, pressT[2] = {0, 0};
bool wasDown[2] = {false, false};

bool checkConfig() {
  for (byte i = 0; i < 6; i++) {
    if (ANG_MIN[i] < 0 || ANG_MAX[i] > 180) return false;
    if (ANG_MIN[i] >= ANG_MAX[i]) return false;
    if (ANG_HOME[i] < ANG_MIN[i] || ANG_HOME[i] > ANG_MAX[i]) return false;
    if (US_MIN[i] < 400 || US_MAX[i] > 2600 || US_MIN[i] >= US_MAX[i]) return false;
  }
  return true;
}

void writeServo(byte i) {
  float a = INVERT[i] ? 180.0 - angle[i] : angle[i];
  float us = US_MIN[i] + (a / 180.0) * (US_MAX[i] - US_MIN[i]);
  pwm.setPWM(CH[i], 0, (uint16_t)(us * 0.2048));   // 50 Hz, 4096 ticks
}

void stopAll() {
  for (byte i = 0; i < 6; i++) vel[i] = 0;
  homing = false; playing = false;
}

void blink(byte times) {
  for (byte i = 0; i < times; i++) { digitalWrite(LED, HIGH); delay(80); digitalWrite(LED, LOW); delay(80); }
}

void savePosesToEeprom() {
  EEPROM.update(0, 0xA5); EEPROM.update(1, poseCount);
  for (byte k = 0; k < poseCount; k++) for (byte i = 0; i < 6; i++) EEPROM.update(2 + k * 6 + i, poses[k][i]);
}

void loadPosesFromEeprom() {
  if (EEPROM.read(0) != 0xA5) return;
  byte c = EEPROM.read(1);
  if (c > MAX_POSES) return;
  for (byte k = 0; k < c; k++) for (byte i = 0; i < 6; i++) {
    byte a = EEPROM.read(2 + k * 6 + i);
    if (a < ANG_MIN[i] || a > ANG_MAX[i]) return;      // saved with other limits: ignore all
    poses[k][i] = a;
  }
  poseCount = c;
}

// returns 0 none, 1 short press, 2 long press (held HOLD_MS)
byte button(byte idx, byte pin) {
  bool down = digitalRead(pin) == LOW;
  byte r = 0;
  if (down && !wasDown[idx]) pressT[idx] = millis();
  if (!down && wasDown[idx]) {
    unsigned long d = millis() - pressT[idx];
    if (d > 40 && d < HOLD_MS) r = 1;
  }
  if (down && wasDown[idx] && pressT[idx] != 0 && millis() - pressT[idx] >= HOLD_MS) { r = 2; pressT[idx] = 0; }
  wasDown[idx] = down;
  return r;
}

void err(const char* code) {
  if (millis() - lastErr < 1000) return;   // do not spam
  lastErr = millis();
  Serial.print(F("ERR,")); Serial.println(code);
  link.print(F("ERR,")); link.println(code);
}

// first move: put every servo at HOME (arm should be near home by hand before power on)
void arm() {
  for (byte i = 0; i < 6; i++) { angle[i] = ANG_HOME[i]; writeServo(i); }
  armed = true;
}

bool parseFrame(char* s) {
  // S,v1,v2,v3,v4,v5,v6
  if (s[0] != 'S' || s[1] != ',') return false;
  int v[6];
  char* p = s + 2;
  for (byte i = 0; i < 6; i++) {
    char* end;
    long x = strtol(p, &end, 10);
    if (end == p) return false;                 // not a number
    if (i < 5 && *end != ',') return false;
    if (i == 5 && *end != '\0') return false;
    v[i] = constrain(x, -100, 100);
    p = end + 1;
  }
  for (byte i = 0; i < 6; i++) vel[i] = (abs(v[i]) < DEADBAND) ? 0 : v[i];
  return true;
}

void handleLine(char* s) {
  if (s[0] == 'X') { stopAll(); return; }
  if (s[0] == 'R') {
    if (!configOk) { err("CAL"); return; }
    if (!armed) arm();
    stopAll(); homing = true; return;
  }
  if (s[0] == 'S') {
    if (!configOk) { err("CAL"); return; }
    if (!parseFrame(s)) { err("PARSE"); return; }
    if (!armed) arm();
    homing = false;
    for (byte i = 0; i < 6; i++) if (vel[i] != 0) playing = false;   // the stick wins over playback
    lastFrame = millis();
  }
}

void setup() {
  Serial.begin(115200);
  link.begin(9600);
  Wire.begin();
  pwm.begin();
  pwm.setPWMFreq(50);
  pinMode(BTN_SAVE, INPUT_PULLUP); pinMode(BTN_PLAY, INPUT_PULLUP); pinMode(LED, OUTPUT);
  configOk = checkConfig();
  if (configOk) loadPosesFromEeprom();
  Serial.println(configOk ? F("arm ready") : F("ERR,CAL: fill the CONFIG block"));
  lastFrame = millis();
}

void loop() {
  // read lines from Uno #2
  while (link.available()) {
    char c = link.read();
    if (c == '\n' || c == '\r') {
      if (n > 0) { buf[n] = 0; handleLine(buf); }
      n = 0;
    } else if (n < sizeof(buf) - 1) buf[n++] = c;
    else n = 0;                                  // line too long, drop it
  }
  if (!configOk) { err("CAL"); return; }

  // buttons
  byte bs = button(0, BTN_SAVE), bp = button(1, BTN_PLAY);
  if (bs == 1) {
    if (!armed) err("NOT_ARMED");
    else if (poseCount >= MAX_POSES) err("FULL");
    else { for (byte i = 0; i < 6; i++) poses[poseCount][i] = (byte)angle[i]; poseCount++; savePosesToEeprom(); blink(poseCount); }
  } else if (bs == 2) { poseCount = 0; playing = false; savePosesToEeprom(); blink(10); }
  if (bp == 1) {
    if (playing) { playing = false; blink(2); }
    else if (poseCount == 0) err("NO_POSES");
    else { if (!armed) arm(); stopAll(); playing = true; playIdx = 0; pauseUntil = 0; }
  }

  // watchdog: link silent -> hold position (playback keeps going)
  if (millis() - lastFrame > WATCHDOG_MS && !homing && !playing) for (byte i = 0; i < 6; i++) vel[i] = 0;

  // move at 50 Hz
  unsigned long now = millis();
  if (armed && now - lastTick >= 20) {
    float dt = (now - lastTick) / 1000.0;
    lastTick = now;
    for (byte i = 0; i < 6; i++) {
      float step = 0;
      if (playing) {
        if (millis() < pauseUntil) continue;
        float d = poses[playIdx][i] - angle[i];
        float m = SPEED_DPS[i] * 0.6 * dt;
        step = (fabs(d) <= m) ? d : (d > 0 ? m : -m);
      } else if (homing) {
        float d = ANG_HOME[i] - angle[i];
        float m = SPEED_DPS[i] * 0.5 * dt;       // homing at half speed
        step = (fabs(d) <= m) ? d : (d > 0 ? m : -m);
      } else if (vel[i] != 0) step = vel[i] / 100.0 * SPEED_DPS[i] * dt;
      if (step != 0) {
        angle[i] = constrain(angle[i] + step, ANG_MIN[i], ANG_MAX[i]);
        writeServo(i);
      }
    }
    if (playing && millis() >= pauseUntil) {            // pose reached? pause, then next one
      bool there = true;
      for (byte i = 0; i < 6; i++) if (fabs(poses[playIdx][i] - angle[i]) > 1.0) there = false;
      if (there) {
        pauseUntil = millis() + PAUSE_MS;
        if (++playIdx >= poseCount) playing = false;
      }
    }
  } else if (!armed) lastTick = now;
}
