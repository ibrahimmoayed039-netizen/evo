package com.restaurant.waiter.data

/** هل الشاشة ظاهرة الآن؟ الواجهة تحدّث بنفسها وهي ظاهرة، وخدمة الخلفية تتولى التنبيه وهي مخفية. */
object AppState {
    @Volatile var foreground = false
}

/** تذاكر «جاهز» التي نُبّه عنها مسبقاً (مشتركة بين الواجهة والخدمة حتى لا يتكرر الصوت/الإشعار لنفس التذكرة). */
object SeenReady {
    private var seen = emptySet<Long>()
    @Synchronized fun fresh(ids: List<Long>): List<Long> {
        val f = ids.filter { it !in seen }
        seen = ids.toSet()
        return f
    }
    @Synchronized fun reset() { seen = emptySet() }
}
