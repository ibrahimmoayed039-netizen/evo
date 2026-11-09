package com.restaurant.waiter.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.restaurant.waiter.MainActivity
import com.restaurant.waiter.R
import com.restaurant.waiter.data.ReadyTicket

object Notifier {
    private const val CH_READY = "ready"
    private const val CH_BG = "background"
    const val FG_ID = 1
    private const val PROBLEM_ID = 2

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_READY, "جاهز للتقديم", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "تنبيه عند جاهزية طلب في المطبخ"
                enableVibration(true)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_BG, "الاتصال في الخلفية", NotificationManager.IMPORTANCE_LOW).apply {
                description = "إشعار ثابت يبقي التطبيق متصلاً بالكاشير لاستقبال التنبيهات"
                setShowBadge(false)
            },
        )
    }

    private fun open(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** إشعار الخدمة الثابت (يفرضه أندرويد لأي خدمة تعمل في الخلفية) */
    fun foreground(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_BG)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("تطبيق النادل متصل")
            .setContentText("يصلك تنبيه عند جاهزية الطلبات")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open(ctx))
            .build()

    private fun idOf(ticketId: Long) = 1000 + (ticketId % 1_000_000).toInt()

    fun ready(ctx: Context, t: ReadyTicket) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        val where = if (t.tableLabel.isNotBlank()) t.tableLabel else t.type
        val n = NotificationCompat.Builder(ctx, CH_READY)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("جاهز للتقديم · $where")
            .setContentText(t.items.joinToString("، "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(t.items.joinToString("\n")))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .setAutoCancel(true)
            .setContentIntent(open(ctx))
            .build()
        try { nm.notify(idOf(t.id), n) } catch (e: SecurityException) {}
    }

    fun cancel(ctx: Context, ticketId: Long) = NotificationManagerCompat.from(ctx).cancel(idOf(ticketId))

    /** تنبيه عند توقف الخدمة لسبب يحتاج المستخدم (انتهاء الجلسة، تغيّر الشهادة) */
    fun problem(ctx: Context, text: String) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        val n = NotificationCompat.Builder(ctx, CH_READY)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("توقفت التنبيهات")
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(open(ctx))
            .build()
        try { nm.notify(PROBLEM_ID, n) } catch (e: SecurityException) {}
    }
}
