# Test order and message spec

## For Youssef (app side)
Messages end with \n, one per line, ASCII.
- Arm (already in the app):  S,b,sh,e,wp,wr,gr   six ints, -100..100, velocity. Send every 60 ms while a stick is held.
- Drive (NEW):  D,left,right   two ints, -100..100.  D,100,100 forward, D,-100,-100 back, D,-100,100 turn left, D,100,-100 turn right.
  Send every 60 ms while the command is active, and send D,0,0 when it ends.
- X = stop everything.   R = arm goes to its home pose.
- Voice (suggested): when a voice command ends, send zeros (S,0,0,0,0,0,0 or D,0,0). Do not rely on a timer inside the car.
  Examples: "forward"/"امام" -> D,70,70 for 500 ms,  "left"/"شمال" -> D,-60,60 for 400 ms,
  "base left" / "القاعدة شمال" -> S,-60,0,0,0,0,0 for 500 ms, "close hand"/"اقفل الايد" -> S,0,0,0,0,0,-60 for 500 ms.
- The car answers only with error lines: ERR,CAL  ERR,PARSE  ERR,UNKNOWN  ERR,OBSTACLE  ERR,DRIVE_NOT_CHECKED
- Safety already on the car: no frame for 500 ms = stop. Arm and car never move together (the second one is ignored).

## Test order (each one before the next)
1. Power: Buck 6V = 6.0 V and Buck 5V = 5.0 V with no load.
2. Wheels: AFMotor test sketch, wheels in the air. Note which port is left/right and which one spins backwards.
   Then in car_uno2.ino: set LEFT_PORTS / RIGHT_PORTS / INVERT_*, and DRIVE_CHECKED = true.
3. HC-05 pairing, then send "D,60,60" from a serial app: wheels turn, stop after 0.5 s.
4. Sonar: hand in front while going forward -> car stops and sends ERR,OBSTACLE.
5. Arm servos one by one with calib_uno1.ino: for each channel find min / max / home. Write them in arm_uno1.ino CONFIG.
6. Arm with the app: tiny stick values first. Home with R.
7. Camera last.

## Wiring added (free parts)
- Uno #2: green LED  D2  -> 330R -> LED -> GND.   red LED  D13 -> 330R -> LED -> GND.
  Battery monitor (optional): battery+ -> 10k -> A4 -> 4.7k -> GND, then BAT_MONITOR = true. Check A4 stays under 5 V with the full battery (12.6 V gives about 4.0 V).
- Uno #1: save button D2 -> GND,  play button D3 -> GND (no resistor needed, INPUT_PULLUP).
  Teach: move the arm with the app to a pose, short press SAVE. Repeat up to 8 poses. Press PLAY to replay, press PLAY again to stop. Hold SAVE 2 s = erase all.
  Poses stay saved after power off. They are ignored if you change the angle limits.
- Uno #2 buzzer (ACTIVE type, the one that beeps by itself on 5 V): A5 -> 100-220R -> buzzer + , other leg GND. One short beep on every ERR, one beep at boot. A passive buzzer will not work with this code.

## Camera (cam_esp32.ino)
- Upload with an FTDI or an ESP32-CAM-MB board (GPIO0 to GND while uploading, then remove it and press reset).
- Set AP_PASS first. Phone joins Wi-Fi ROBOT-CAM, then open http://192.168.4.1/stream in the browser.
- Youssef can show it in the app with a WebView pointing to that address. The phone loses mobile internet while joined to the camera Wi-Fi.
- Power: 5 V from the Buck 5V, at least 500 mA. Add a 470 uF cap near the 5V pin if it resets by itself.
