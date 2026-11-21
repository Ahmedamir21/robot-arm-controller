// ESP32-CAM (AI Thinker). Makes its own Wi-Fi (no router needed) and streams video.
// Phone: join Wi-Fi "ROBOT-CAM", then open  http://192.168.4.1/stream  (or / for one picture).
// It is not connected to any Arduino. It refuses to start until you change AP_PASS.
// Arduino IDE: Board = "AI Thinker ESP32-CAM", install "esp32" boards package.
#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

// ===================== CONFIG: EDIT THIS =====================
const char* AP_SSID = "ROBOT-CAM";
const char* AP_PASS = "CHANGE_ME";     // at least 8 characters. Change it or the camera will not start
// =============================================================

// AI Thinker pin map
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

static const char* BOUNDARY = "frame";

esp_err_t photoHandler(httpd_req_t* req) {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { httpd_resp_send_500(req); return ESP_FAIL; }
  httpd_resp_set_type(req, "image/jpeg");
  esp_err_t r = httpd_resp_send(req, (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return r;
}

esp_err_t streamHandler(httpd_req_t* req) {
  httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");
  char head[64];
  while (true) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) return ESP_FAIL;
    int n = snprintf(head, sizeof(head), "\r\n--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", BOUNDARY, fb->len);
    esp_err_t r = httpd_resp_send_chunk(req, head, n);
    if (r == ESP_OK) r = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (r != ESP_OK) break;                 // the phone closed the page
  }
  return ESP_OK;
}

void setup() {
  Serial.begin(115200);
  if (strcmp(AP_PASS, "CHANGE_ME") == 0 || strlen(AP_PASS) < 8) {
    Serial.println("ERR,CAL: change AP_PASS (8+ characters) and upload again");
    while (true) delay(1000);               // stop here, do nothing else
  }
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_QVGA;            // 320x240, smooth on Wi-Fi. Try FRAMESIZE_VGA later
  c.jpeg_quality = 14; c.fb_count = 2; c.grab_mode = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&c) != ESP_OK) {
    Serial.println("ERR,CAMERA: init failed. Check power (5V, 500 mA+) and the ribbon cable");
    while (true) delay(1000);
  }
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("AP ready: "); Serial.println(WiFi.softAPIP());

  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  httpd_handle_t srv = NULL;
  cfg.server_port = 80;
  if (httpd_start(&srv, &cfg) == ESP_OK) {
    httpd_uri_t photo  = {"/",       HTTP_GET, photoHandler,  NULL};
    httpd_uri_t stream = {"/stream", HTTP_GET, streamHandler, NULL};
    httpd_register_uri_handler(srv, &photo);
    httpd_register_uri_handler(srv, &stream);
  } else Serial.println("ERR,HTTP: server did not start");
}

void loop() { delay(1000); }   // everything runs in the server tasks
