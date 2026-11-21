// Calibration tool for the arm (Uno #1 + PCA9685). Open Serial Monitor: 115200, "Newline".
// Moves ONE servo in small steps so you can find its safe min / max / home angle.
// Commands:  c3  = pick PCA channel 3 (0..5)   p90 = go to 90 deg (first move, do it near the real pose)
//            +   = +2 deg    -  = -2 deg      s = print state     o = turn the signal off (servo goes limp)
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm;
const int US_MIN = 600, US_MAX = 2400;   // same assumption as the main sketch
const int STEP = 2;
int ch = 0;
float ang[6] = {-1, -1, -1, -1, -1, -1};  // -1 = this channel was never moved

void out() {
  float us = US_MIN + (ang[ch] / 180.0) * (US_MAX - US_MIN);
  pwm.setPWM(ch, 0, (uint16_t)(us * 0.2048));
  Serial.print(F("ch ")); Serial.print(ch); Serial.print(F("  angle ")); Serial.print(ang[ch], 0);
  Serial.print(F("  us ")); Serial.println((int)us);
}

void setup() {
  Serial.begin(115200);
  Wire.begin(); pwm.begin(); pwm.setPWMFreq(50);
  Serial.println(F("calib ready. Start with c<channel> then p<angle>"));
}

void loop() {
  if (!Serial.available()) return;
  String s = Serial.readStringUntil('\n'); s.trim();
  if (s.length() == 0) return;
  char c = s[0];
  if (c == 'c') {
    int v = s.substring(1).toInt();
    if (v < 0 || v > 5) { Serial.println(F("ERR channel must be 0..5")); return; }
    ch = v; Serial.print(F("channel ")); Serial.println(ch);
  } else if (c == 'p') {
    int v = s.substring(1).toInt();
    if (v < 0 || v > 180) { Serial.println(F("ERR angle must be 0..180")); return; }
    ang[ch] = v; out();
  } else if (c == '+' || c == '-') {
    if (ang[ch] < 0) { Serial.println(F("ERR first use p<angle>")); return; }
    ang[ch] = constrain(ang[ch] + (c == '+' ? STEP : -STEP), 0, 180); out();
  } else if (c == 's') {
    for (int i = 0; i < 6; i++) { Serial.print(i); Serial.print(F(": ")); Serial.println(ang[i]); }
  } else if (c == 'o') {
    pwm.setPWM(ch, 0, 0); ang[ch] = -1; Serial.println(F("signal off"));
  } else Serial.println(F("ERR unknown command"));
}
