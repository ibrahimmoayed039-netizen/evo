package com.restaurant.waiter.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.restaurant.waiter.data.ApiClient
import com.restaurant.waiter.data.ApiException
import com.restaurant.waiter.data.AppState
import com.restaurant.waiter.data.Discovery
import com.restaurant.waiter.data.Prefs
import com.restaurant.waiter.data.SeenReady
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * خدمة أمامية (إشعار ثابت) تبقي التطبيق متصلاً بالكاشير بعد إغلاق الشاشة أو الخروج من التطبيق،
 * وتنبّه عند جاهزية الطلبات. تتولى العمل فقط حين يكون التطبيق مخفياً؛ وهو ظاهر تحدّث الواجهة نفسها.
 * تبدأ عند الدخول وتتوقف عند الخروج أو انتهاء الجلسة. لا تعمل بعد إعادة تشغيل الجوال حتى يفتح النادل التطبيق.
 */
class ReadyService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Prefs(this)
        if (prefs.token.isBlank() || prefs.server.isBlank() || prefs.pin.isBlank()) { stopSelf(); return START_NOT_STICKY }
        Notifier.ensureChannels(this)
        try {
            val n = Notifier.foreground(this)
            if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Notifier.FG_ID, n)
        } catch (e: Exception) {
            stopSelf(); return START_NOT_STICKY
        }
        job?.cancel() // دخول جديد = رمز جلسة جديد
        job = scope.launch { loop(prefs) }
        return START_STICKY
    }

    private suspend fun loop(prefs: Prefs) {
        val api = ApiClient().also { it.base = prefs.server; it.pin = prefs.pin; it.token = prefs.token }
        val shown = mutableSetOf<Long>()
        var fails = 0
        while (scope.isActive) {
            delay(if (fails == 0) 5000L else minOf(30000L, 5000L * (fails + 1)))
            if (AppState.foreground) {
                shown.forEach { Notifier.cancel(this, it) }
                shown.clear()
                continue
            }
            try {
                val r = api.ready()
                fails = 0
                val fresh = SeenReady.fresh(r.map { it.id }).toSet()
                r.filter { it.id in fresh }.forEach { Notifier.ready(this, it); shown += it.id }
                shown.filter { id -> r.none { it.id == id } }.forEach { Notifier.cancel(this, it); shown -= it }
            } catch (e: ApiException) {
                if (e.code == 401 || e.code == 495) {
                    prefs.token = ""
                    Notifier.problem(this, e.message ?: "افتح التطبيق وسجّل الدخول من جديد")
                    stopSelf()
                    return
                }
                fails++
            } catch (e: IOException) {
                fails++
                // ربما تغيّر عنوان الكاشير (DHCP): نبحث عنه بنفس البصمة
                if (fails % 4 == 3) {
                    try {
                        Discovery.discover().firstOrNull { it.fp == prefs.pin }?.let { api.base = it.url; prefs.server = it.url }
                    } catch (x: Exception) {
                    }
                }
            } catch (e: Exception) {
                fails++
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun start(ctx: Context) {
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, ReadyService::class.java)) } catch (e: Exception) {}
        }
        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, ReadyService::class.java)) } catch (e: Exception) {}
        }
    }
}
