package com.armcontrol.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private lateinit var web: WebView
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var out: OutputStream? = null
    private val writer = Executors.newSingleThreadExecutor()
    private var recognizer: SpeechRecognizer? = null
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/index.html")
        hideBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    @Suppress("DEPRECATION")
    private fun hideBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    override fun onDestroy() {
        recognizer?.destroy()
        closeSocket()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (requestCode == 2) js("window.onMicPerm($ok)") else js("window.onBtPerm($ok)")
    }

    private fun hasPerm(): Boolean =
        Build.VERSION.SDK_INT < 31 ||
                checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun adapter(): BluetoothAdapter? =
        (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun js(code: String) {
        runOnUiThread { web.evaluateJavascript(code, null) }
    }

    private fun state(st: String, msg: String) {
        js("window.onBtState(${JSONObject.quote(st)}, ${JSONObject.quote(msg)})")
    }

    private fun doVoice(lang: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("window.onVoiceState('no speech service on this phone')")
            return
        }
        val sr = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also { recognizer = it }
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { js("window.onVoiceState('listening...')") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { js("window.onVoiceState('thinking...')") }
            override fun onError(error: Int) { js("window.onVoiceState('error', $error)") }
            override fun onResults(results: Bundle?) {
                val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val arr = JSONArray()
                if (list != null) for (t in list) arr.put(t)
                js("window.onVoice(${arr.toString()})")
            }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        sr.startListening(i)
    }

    private fun closeSocket() {
        try { socket?.close() } catch (_: Exception) {}
        socket = null
        out = null
    }

    @SuppressLint("MissingPermission")
    private fun doConnect(mac: String) {
        closeSocket()
        state("connecting", mac)
        try {
            val ad = adapter() ?: throw Exception("no bluetooth on this phone")
            if (!ad.isEnabled) throw Exception("Bluetooth is off")
            val dev = ad.getRemoteDevice(mac)
            ad.cancelDiscovery()
            val sk = dev.createRfcommSocketToServiceRecord(spp)
            sk.connect()
            socket = sk
            out = sk.outputStream
            state("connected", dev.name ?: mac)
            readLoop(sk.inputStream)
        } catch (e: Exception) {
            closeSocket()
            state("error", e.message ?: "connect failed")
        }
    }

    private fun readLoop(ins: InputStream) {
        val buf = ByteArray(256)
        val sb = StringBuilder()
        try {
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                for (i in 0 until n) {
                    val c = buf[i].toInt().toChar()
                    if (c == '\n') {
                        val line = sb.toString().trim()
                        sb.setLength(0)
                        if (line.isNotEmpty()) js("window.onBtLine(${JSONObject.quote(line)})")
                    } else if (c != '\r') {
                        sb.append(c)
                    }
                }
            }
        } catch (_: Exception) {
        }
        if (socket != null) {
            closeSocket()
            state("disconnected", "lost")
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun hasPermission(): Boolean = hasPerm()

        @JavascriptInterface
        fun requestPermission() {
            if (Build.VERSION.SDK_INT >= 31) {
                runOnUiThread { requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 1) }
            }
        }

        @SuppressLint("MissingPermission")
        @JavascriptInterface
        fun listDevices(): String {
            val arr = JSONArray()
            if (!hasPerm()) return arr.toString()
            val ad = adapter() ?: return arr.toString()
            for (d in ad.bondedDevices) {
                arr.put(JSONObject().put("name", d.name ?: "?").put("mac", d.address))
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun connect(mac: String) {
            Thread { doConnect(mac) }.start()
        }

        @JavascriptInterface
        fun disconnect() {
            closeSocket()
            state("disconnected", "")
        }

        @JavascriptInterface
        fun write(s: String) {
            val o = out ?: return
            writer.execute {
                try {
                    o.write(s.toByteArray())
                    o.flush()
                } catch (_: Exception) {
                    if (socket != null) {
                        closeSocket()
                        state("disconnected", "lost")
                    }
                }
            }
        }

        @JavascriptInterface
        fun hasMic(): Boolean =
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun requestMic() {
            runOnUiThread { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2) }
        }

        @JavascriptInterface
        fun startVoice(lang: String) {
            runOnUiThread { doVoice(lang) }
        }

        @Suppress("DEPRECATION")
        @JavascriptInterface
        fun vibrate(ms: Int) {
            val v = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                v.vibrate(ms.toLong())
            }
        }
    }
}
