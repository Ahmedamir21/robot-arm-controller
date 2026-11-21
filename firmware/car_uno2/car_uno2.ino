// Uno #2: car. HC-05 on hardware Serial (D0/D1), L293D shield for 4 TT motors,
// HC-SR04 on A2/A3, SG90 on D10, link to the arm Uno on A0 (RX) / A1 (TX).
// Frames from the phone:  S,b,sh,e,wp,wr,gr  -> arm   |  D,left,right -> drive
//                         X -> stop everything    |  R -> arm goes home
//                         A,1 -> obstacle avoidance on (send it every 200 ms)  |  A,0 -> off
// Replies to the phone:   MODE,AUTO / MODE,MAN, DST,<cm> while avoiding, ERR,<code>
// It refuses to drive until DRIVE_CHECKED is set to true.
#include <AFMotor.h>
#include <Servo.h>
#include <SoftwareSerial.h>

// ===================== CONFIG: EDIT THESE =====================
const bool DRIVE_CHECKED = false;   // set true after the wheel test shows each wheel direction is right
// which shield port is on which side. ASSUMED, change after the wheel test
const byte LEFT_PORTS[2]  = {1, 2};
const byte RIGHT_PORTS[2] = {3, 4};
const bool INVERT_LEFT = false, INVERT_RIGHT = false;   // flip if a side goes backwards
const int  MAX_PWM = 160;           // 0..255 speed cap. ASSUMED low, TT motors are weak and 6V is a lot
const int  STOP_CM = 20;            // stop going forward closer than this
const int  RAMP = 8;                // speed change per 20 ms (smooth start/stop)
// battery monitor: 10k from battery+ to A4, 4.7k from A4 to GND. Leave false until it is wired
const bool BAT_MONITOR = false;
const float BAT_SCALE = 14.7 / 4.7;  // (10k+4.7k)/4.7k. Fix it by comparing with a multimeter
const float BAT_WARN_V = 9.9;       // 3.3 V per cell, red LED blinks + ERR,LOWBAT
const float BAT_STOP_V = 9.3;       // below this the car refuses to drive
// obstacle avoidance (project 4). All of these are ASSUMED, tune them on the floor
const int  AUTO_SPEED = 55;         // 0..100 while driving by itself
const int  TURN_SPEED = 70;         // 0..100 while turning
const int  AVOID_CM = 25;           // obstacle closer than this: stop and look around
const int  DEAD_END_CM = 15;        // both sides closer than this: back up first
const int  SG_LEFT_DEG = 150, SG_RIGHT_DEG = 30;   // sonar servo angles. Swap if left/right are reversed
const unsigned int TURN_MS = 450;   // time of a turn (about 90 degrees?). No encoders, so tune it
const unsigned int BACK_MS = 400;
// ==============================================================

const byte TRIG = A2, ECHO = A3, SG_PIN = 10, BAT_PIN = A4, LED_G = 2, LED_R = 13, BUZ = A5;   // active buzzer (not passive): pin -> 100R -> buzzer -> GND.   // LEDs: pin -> 330R -> LED -> GND
const unsigned long WATCHDOG_MS = 500;

AF_DCMotor m1(1), m2(2), m3(3), m4(4);
AF_DCMotor* mot[4] = {&m1, &m2, &m3, &m4};
Servo sg;
SoftwareSerial link(A0, A1);          // RX = A0, TX = A1

int driveL = 0, driveR = 0;           // target -100..100
int curL = 0, curR = 0;               // what the motors really get
byte nearHits = 0;                    // sonar debounce
float batV = 0; bool lowBat = false, stopBat = false;
unsigned long buzUntil = 0, lastTick = 0, lastBatT = 0, lastGood = 0, lastErrLed = 0;
bool armMoving = false;
unsigned long lastBt = 0, lastSonar = 0, lastErr = 0;
int distCm = 999;
char buf[48]; byte n = 0, lb = 0; char lbuf[40];
enum AState : byte { A_FWD, A_SCAN_L, A_SCAN_R, A_BACK, A_TURN, A_SETTLE };
bool autoOn = false; AState aState = A_FWD;
unsigned long aT = 0, aLastDst = 0; int distL = 0, distR = 0; int turnDir = 1;

void setMotor(byte port, int v, bool inv) {
  if (inv) v = -v;
  int pwmv = map(abs(v), 0, 100, 0, MAX_PWM);
  AF_DCMotor* m = mot[port - 1];
  m->setSpeed(pwmv);
  m->run(v == 0 ? RELEASE : (v > 0 ? FORWARD : BACKWARD));
}

void applyDrive() {
  for (byte i = 0; i < 2; i++) {
    setMotor(LEFT_PORTS[i], curL, INVERT_LEFT);
    setMotor(RIGHT_PORTS[i], curR, INVERT_RIGHT);
  }
}

void stopDrive() { driveL = driveR = curL = curR = 0; applyDrive(); }   // hard stop, no ramp

int toward(int cur, int tgt) {
  if (tgt > cur) return min(cur + RAMP, tgt);
  return max(cur - RAMP, tgt);
}

void sendErr(const char* c) {
  if (millis() - lastErr < 1000) return;
  lastErr = millis();
  Serial.print(F("ERR,")); Serial.println(c);   // goes to the phone
  lastErrLed = millis(); buzUntil = millis() + 150;   // short beep on every error
}

int readSonar() {
  digitalWrite(TRIG, LOW); delayMicroseconds(3);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long t = pulseIn(ECHO, HIGH, 20000UL);      // ~3.4 m max
  if (t == 0) return 999;                              // nothing in range
  return t / 58;
}

bool allZeroS(char* s) {            // is this S frame all zeros?
  for (char* p = s + 2; *p; p++) if (*p != '0' && *p != ',' && *p != '-' && *p != '+') return false;
  return true;
}

void forwardToArm(const char* s) { link.println(s); }

int avgSonar() {                      // average of 3 readings, 999 = nothing in range
  long sum = 0; byte ok = 0;
  for (byte i = 0; i < 3; i++) { int d = readSonar(); sum += d; ok++; delay(30); }
  return sum / ok;
}

void autoStop() {
  if (!autoOn) return;
  autoOn = false; stopDrive(); sg.write(90);
  Serial.println(F("MODE,MAN"));
}

void autoStart() {
  autoOn = true; aState = A_FWD; aT = millis(); sg.write(90);
  Serial.println(F("MODE,AUTO"));
}

void autoStep(unsigned long now) {
  switch (aState) {
    case A_FWD:
      driveL = driveR = AUTO_SPEED;                       // the ramp softens the start
      if (now - lastSonar >= 80) {
        lastSonar = now;
        distCm = readSonar();
        if (distCm < AVOID_CM) nearHits++; else nearHits = 0;
        if (now - aLastDst >= 500) { aLastDst = now; Serial.print(F("DST,")); Serial.println(distCm); }
        if (nearHits >= 2) { nearHits = 0; stopDrive(); sg.write(SG_LEFT_DEG); aState = A_SCAN_L; aT = now; }
      }
      break;
    case A_SCAN_L:
      if (now - aT >= 450) { distL = avgSonar(); sg.write(SG_RIGHT_DEG); aState = A_SCAN_R; aT = millis(); }
      break;
    case A_SCAN_R:
      if (now - aT >= 650) {                              // the servo needs time to cross
        distR = avgSonar(); sg.write(90);
        Serial.print(F("DST,L")); Serial.print(distL); Serial.print(F(",R")); Serial.println(distR);
        turnDir = (distL >= distR) ? -1 : 1;              // -1 = turn left, 1 = turn right
        if (max(distL, distR) < DEAD_END_CM) { driveL = driveR = -AUTO_SPEED; aState = A_BACK; }
        else { driveL = turnDir * TURN_SPEED; driveR = -turnDir * TURN_SPEED; aState = A_TURN; }
        aT = millis();
      }
      break;
    case A_BACK:
      if (now - aT >= BACK_MS) { driveL = TURN_SPEED; driveR = -TURN_SPEED; turnDir = 1; aState = A_TURN; aT = now; }
      break;
    case A_TURN:
      if (now - aT >= TURN_MS) { stopDrive(); aState = A_SETTLE; aT = now; }
      break;
    case A_SETTLE:
      if (now - aT >= 300) { nearHits = 0; aState = A_FWD; }
      break;
  }
}

void handleLine(char* s) {
  lastBt = millis();
  if (s[0] == 'X') {
    autoStop(); stopDrive(); link.println(F("X")); return;
  }
  if (s[0] == 'R') {
    autoStop(); stopDrive(); link.println(F("R")); return;
  }
  if (s[0] == 'A' && s[1] == ',') {
    if (s[2] != '1') { autoStop(); return; }
    if (!DRIVE_CHECKED) { sendErr("DRIVE_NOT_CHECKED"); return; }
    if (armMoving || stopBat) { if (stopBat) sendErr("LOWBAT"); return; }
    if (!autoOn) autoStart();
    lastGood = millis();
    return;
  }
  if (s[0] == 'D' && s[1] == ',') {
    if (!DRIVE_CHECKED) { sendErr("DRIVE_NOT_CHECKED"); stopDrive(); return; }
    char* e1; long l = strtol(s + 2, &e1, 10);
    if (e1 == s + 2 || *e1 != ',') { sendErr("PARSE"); return; }
    char* e2; long r = strtol(e1 + 1, &e2, 10);
    if (e2 == e1 + 1 || *e2 != '\0') { sendErr("PARSE"); return; }
    autoStop();                                        // a manual drive command cancels auto
    if (armMoving || stopBat) { stopDrive(); if (stopBat) sendErr("LOWBAT"); return; }   // interlock / flat battery
    driveL = constrain(l, -100, 100); driveR = constrain(r, -100, 100);   // ramp does the rest
    lastGood = millis();
    return;
  }
  if (s[0] == 'S' && s[1] == ',') {
    if (autoOn) return;                                  // arm stays still while the car drives itself
    bool zero = allZeroS(s);
    armMoving = !zero;
    if (armMoving && (driveL != 0 || driveR != 0)) stopDrive();   // interlock: car is moving
    forwardToArm(s);
    lastGood = millis();
    return;
  }
  sendErr("UNKNOWN");
}

void setup() {
  Serial.begin(9600);                // HC-05 default. Unplug D0 when uploading
  link.begin(9600);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  pinMode(LED_G, OUTPUT); pinMode(LED_R, OUTPUT); pinMode(BUZ, OUTPUT);
  digitalWrite(BUZ, HIGH); delay(80); digitalWrite(BUZ, LOW);   // boot beep
  sg.attach(SG_PIN); sg.write(90);   // sonar servo centered
  stopDrive();
  lastBt = millis();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (n > 0) { buf[n] = 0; handleLine(buf); }
      n = 0;
    } else if (n < sizeof(buf) - 1) buf[n++] = c;
    else n = 0;
  }
  // errors coming from the arm Uno go to the phone
  while (link.available()) {
    char c = link.read();
    if (c == '\n') { lbuf[lb] = 0; if (lb > 0 && lbuf[0] == 'E') Serial.println(lbuf); lb = 0; }
    else if (c != '\r' && lb < sizeof(lbuf) - 1) lbuf[lb++] = c;
    else if (lb >= sizeof(lbuf) - 1) lb = 0;
  }
  unsigned long now = millis();
  // watchdog: phone silent -> stop the car, tell the arm to stop too
  if (now - lastBt > WATCHDOG_MS) {
    autoStop();
    if (driveL != 0 || driveR != 0) stopDrive();
    if (armMoving) { link.println(F("X")); armMoving = false; }
    lastBt = now - WATCHDOG_MS;      // avoid repeating
  }
  // ramp the motors every 20 ms
  if (now - lastTick >= 20) {
    lastTick = now;
    if (curL != driveL || curR != driveR) { curL = toward(curL, driveL); curR = toward(curR, driveR); applyDrive(); }
  }
  if (autoOn) autoStep(now);
  // obstacle check 10 times a second, only while going forward by hand. 2 close readings in a row = stop
  if (!autoOn && now - lastSonar >= 100) {
    lastSonar = now;
    if (driveL > 0 && driveR > 0) {
      distCm = readSonar();
      if (distCm < STOP_CM) nearHits++; else nearHits = 0;
      if (nearHits >= 2) { stopDrive(); sendErr("OBSTACLE"); nearHits = 0; }
    } else nearHits = 0;
  }
  // battery check once a second
  if (BAT_MONITOR && now - lastBatT >= 1000) {
    lastBatT = now;
    batV = analogRead(BAT_PIN) * 5.0 / 1023.0 * BAT_SCALE;
    lowBat = batV < BAT_WARN_V; stopBat = batV < BAT_STOP_V;
    if (lowBat) sendErr("LOWBAT");
    if (stopBat) stopDrive();
  }
  digitalWrite(BUZ, millis() < buzUntil);
  // LEDs: green = phone is talking, red = error / low battery
  digitalWrite(LED_G, (now - lastGood < 1000) ? HIGH : (now / 500) % 2);          // blinks while idle
  digitalWrite(LED_R, (now - lastErrLed < 1500) ? HIGH : (lowBat && (now / 300) % 2));
}
