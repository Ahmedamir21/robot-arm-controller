# Mobile Robotic Manipulator (CSAI 205, projects 3 + 4)

A 4WD car with a 6-servo robotic arm. The phone controls everything over a Bluetooth HC-05. The car can also drive by itself and avoid obstacles with an ultrasonic sensor on a servo.

## What is in this repo
- `app/` Android app (a WebView page in `app/src/main/assets` and a small Kotlin bridge for Bluetooth and voice)
- `firmware/` Arduino sketches: `car_uno2` (car + Bluetooth + obstacle avoidance), `arm_uno1` (arm), `calib_uno1` (servo calibration), `cam_esp32` (camera stream)
- `firmware/TEST_AND_SPEC.md` wiring notes and the order to test things

## App
- Drive tab: joystick for the car, speed slider, AUTO button (obstacle avoidance), camera view
- Arm tab: hold buttons for the 6 joints, Home, speed, invert checkbox per joint
- Voice tab: say a part and a direction in Arabic or English, e.g. "elbow down" or "كوع تحت". Wrong directions are refused and the app says why
- STOP button is always on top. It sends X and locks the controls until you press Release
- The app stops everything if it goes to the background

## Protocol (9600 baud, lines end with newline, values -100..100)
- `S,base,shoulder,elbow,wristPitch,wristRoll,gripper` arm speeds, sent every 60 ms while a button is held
- `D,left,right` car wheel speeds
- `A,1` obstacle avoidance on (send every 200 ms), `A,0` off
- `X` stop everything, `R` arm home
- Replies from the car: `MODE,AUTO`, `MODE,MAN`, `DST,<cm>`, `ERR,<code>`

## Safety
The sketches refuse to move until you fill in their CONFIG block (servo limits, motor sides). If the phone is silent for 500 ms everything stops. The arm and the car never move together.

## Camera
The ESP32-CAM makes its own Wi-Fi (`ROBOT-CAM`). Join it from the phone, then use the camera button in the Drive tab. Bluetooth stays connected.

## Build
The APK is built by GitHub Actions on every push to main (`.github/workflows/build.yml`). Locally: `gradle assembleDebug`.
