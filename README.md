# Robot Arm Controller (Android)

Android app to control our 6-DOF robotic arm (CSAI 205 project) from a phone over a Bluetooth HC-05 module.

## Features
- Two joysticks (base/shoulder and wrist pitch/elbow), wrist rotation and gripper hold buttons, speed slider
- Emergency stop and reset buttons
- Mode buttons: POT (potentiometers), JOY (phone joystick), HOME
- Per-joint sliders with live angles read from the arm
- Saved poses and a pose sequence (play, loop)
- Export / import poses as poses.json (same format as the laptop Python scripts)
- Auto reconnect to the last paired HC-05

## Install
Download `RobotArm.apk` from the Releases page, open it on the phone and allow install from unknown sources.
Pair the HC-05 first from the phone Bluetooth settings (PIN 1234 or 0000), then open the app, pick it and press Connect.

## Protocol (9600 baud, lines ending with newline)
- `S,base,shoulder,elbow,wristPitch,wristRot,gripper,speed` joystick frame (-100..100, speed 1..10), sent 10 times per second
- `X` emergency stop, `R` reset
- `MODE:POT`, `MODE:JOY`, `HOME`, `STOP`, `READ`, `STATUS`, `ALL:a,b,c,d,e,f`, `S1:90` ... `S6:90`

## Build
The APK is built by GitHub Actions on every push (see `.github/workflows/build.yml`).
Locally: `gradle assembleDebug` with the Android SDK installed.
