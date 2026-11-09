package com.restaurant.waiter.data

import android.content.Context

class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("waiter", Context.MODE_PRIVATE)

    /** عنوان الكاشير الأخير (https://ip:port) */
    var server: String
        get() = sp.getString("server", "") ?: ""
        set(v) { sp.edit().putString("server", v).apply() }

    /** بصمة SHA-256 (64 خانة) لشهادة الكاشير التي أكّدها المستخدم؛ الاتصال يُرفض لأي بصمة غيرها */
    var pin: String
        get() = sp.getString("pin", "") ?: ""
        set(v) { sp.edit().putString("pin", v).apply() }

    /** رمز الجلسة الحالي: تقرؤه خدمة التنبيهات في الخلفية. يُمسح عند الخروج وانتهاء الجلسة (صلاحيته 12 ساعة ويلغيها الكاشير) */
    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) { sp.edit().putString("token", v).apply() }

    var lastUser: String
        get() = sp.getString("lastUser", "") ?: ""
        set(v) { sp.edit().putString("lastUser", v).apply() }

    var batteryAsked: Boolean
        get() = sp.getBoolean("batteryAsked", false)
        set(v) { sp.edit().putBoolean("batteryAsked", v).apply() }
}
