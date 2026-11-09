package com.restaurant.waiter.ui

import android.app.Application
import android.graphics.BitmapFactory
import android.media.RingtoneManager
import android.os.PowerManager
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.restaurant.waiter.data.*
import com.restaurant.waiter.notify.ReadyService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.UUID

enum class Screen { CONNECT, LOGIN, TABLES, ORDER }

/** وجهة الطلب الحالي: طاولة أو سفري */
data class Target(val tableId: String?, val label: String, val takeaway: Boolean)

/** طلب تأكيد بصمة شهادة الكاشير: changed = تختلف عن البصمة المقترن بها سابقاً (تحذير مشدّد) */
data class TrustRequest(val url: String, val fp: String, val name: String, val changed: Boolean)

class WaiterViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private val api = ApiClient()

    var screen by mutableStateOf(Screen.CONNECT); private set
    var server by mutableStateOf(prefs.server.replace(Regex("^https?://"), ""))
    var restaurant by mutableStateOf(""); private set
    var staff by mutableStateOf<List<Staff>>(emptyList()); private set
    var userName by mutableStateOf(""); private set
    var tables by mutableStateOf<List<TableInfo>>(emptyList()); private set
    var menu by mutableStateOf<Menu?>(null); private set
    var ready by mutableStateOf<List<ReadyTicket>>(emptyList()); private set
    var existing by mutableStateOf<OrderInfo?>(null); private set
    var target by mutableStateOf<Target?>(null); private set
    var cart by mutableStateOf<List<CartLine>>(emptyList()); private set
    var cartOpen by mutableStateOf(false)
    var confirmLeave by mutableStateOf(false)
    var busy by mutableStateOf(false); private set
    var sending by mutableStateOf(false); private set
    var offline by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var found by mutableStateOf<List<Found>>(emptyList()); private set
    var searching by mutableStateOf(false); private set
    var trust by mutableStateOf<TrustRequest?>(null); private set
    var askBattery by mutableStateOf(false); private set

    val pinned: String get() = prefs.pin
    private val images = object : LruCache<String, ImageBitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }

    val lastUserId: String get() = prefs.lastUser
    var foreground: Boolean
        get() = AppState.foreground
        set(v) { AppState.foreground = v }

    private var loggedIn = false
    private var pendingClientId: String? = null
    private var nextUid = 1L

    init {
        if (prefs.server.isNotBlank() && prefs.pin.isNotBlank()) autoConnect()
        viewModelScope.launch {
            while (true) {
                delay(5000)
                if (loggedIn && foreground) poll()
            }
        }
    }

    // ---------- الاتصال والدخول ----------
    private fun normalize(input: String): String? {
        val m = Regex("^(?:https?://)?([A-Za-z0-9.\\-]+)(?::(\\d{1,5}))?/?$").matchEntire(input.trim()) ?: return null
        val port = m.groupValues[2].ifEmpty { "3838" }
        return "https://${m.groupValues[1]}:$port"
    }

    private fun launchApi(showBusy: Boolean = true, block: suspend () -> Unit) {
        viewModelScope.launch {
            if (showBusy) busy = true
            try {
                block()
                offline = false
            } catch (e: ApiException) {
                if (e.code == 401 && loggedIn) sessionExpired()
                else if (e.code == 495) pinBroken()
                else error = e.message
            } catch (e: IOException) {
                offline = true
                error = "تعذّر الاتصال بجهاز الكاشير. تأكد من الواي فاي والعنوان"
            } catch (e: Exception) {
                error = e.message ?: "خطأ غير متوقع"
            } finally {
                if (showBusy) busy = false
            }
        }
    }

    fun connect() {
        val url = normalize(server)
        if (url == null) { error = "أدخل عنوان جهاز الكاشير مثل 192.168.1.20:3838"; return }
        error = null
        launchApi { handshake(url) }
    }

    /** اتصال تلقائي بآخر كاشير مقترن؛ إن تغيّر عنوانه (DHCP) نبحث عنه بنفس البصمة. */
    private fun autoConnect() = launchApi {
        api.pin = prefs.pin
        try {
            handshake(prefs.server)
        } catch (e: IOException) {
            val hit = Discovery.discover().firstOrNull { it.fp == prefs.pin } ?: throw e
            handshake(hit.url)
        }
    }

    /** يقرأ بصمة الكاشير: مطابقة للمقترنة ← يكمل بلا سؤال؛ غير ذلك ← يطلب من المستخدم تأكيدها بالعين. */
    private suspend fun handshake(url: String) {
        val p = api.probe(url)
        if (p.app != "restaurant-pos-waiter") throw ApiException("هذا العنوان ليس خادم تطبيق النادل", 0)
        if (p.fp == prefs.pin) finishConnect(url, p.name, p.fp)
        else trust = TrustRequest(url, p.fp, p.name, changed = prefs.pin.isNotBlank())
    }

    private suspend fun finishConnect(url: String, name: String, fp: String) {
        api.base = url
        api.pin = fp
        api.token = null
        restaurant = name
        server = url.removePrefix("https://")
        prefs.server = url
        prefs.pin = fp
        staff = api.staff()
        screen = Screen.LOGIN
    }

    fun confirmTrust() {
        val t = trust ?: return
        trust = null
        error = null
        launchApi { finishConnect(t.url, t.name, t.fp) }
    }

    fun cancelTrust() { trust = null }

    fun search() {
        if (searching) return
        searching = true
        viewModelScope.launch {
            try { found = Discovery.discover() } catch (e: Exception) { found = emptyList() } finally { searching = false }
        }
    }

    fun connectTo(f: Found) { server = "${f.host}:${f.port}"; connect() }

    fun toConnect() { stopAlerts(); error = null; found = emptyList(); screen = Screen.CONNECT }

    fun login(s: Staff, pin: String) {
        if (pin.length < 4) { error = "أدخل الرمز السري (4 أرقام على الأقل)"; return }
        error = null
        launchApi {
            val (token, name) = api.login(s.id, pin)
            api.token = token
            userName = name
            loggedIn = true
            prefs.lastUser = s.id
            prefs.token = token
            SeenReady.reset()
            ReadyService.start(getApplication())
            checkBattery()
            val m = api.menu()
            menu = m
            refreshBoard()
            screen = Screen.TABLES
        }
    }

    fun logout() {
        val wasIn = loggedIn
        loggedIn = false
        prefs.token = ""
        ReadyService.stop(getApplication()) // التنبيهات تتوقف فوراً؛ رمز الجلسة يبقى في api حتى يُنهي الخادم الجلسة
        cart = emptyList(); existing = null; target = null; cartOpen = false
        viewModelScope.launch { if (wasIn) try { api.logout() } catch (e: Exception) {}; api.token = null }
        screen = Screen.LOGIN
        launchApi(false) { staff = api.staff() }
    }

    private fun sessionExpired() {
        stopAlerts()
        error = "انتهت الجلسة، سجّل الدخول من جديد"
        screen = Screen.LOGIN
    }

    /** شهادة الكاشير تغيّرت (أُعيد إنشاؤها): نعود لشاشة الاتصال ليؤكد المستخدم البصمة الجديدة */
    private fun pinBroken() {
        stopAlerts()
        error = "تغيّرت شهادة الكاشير. اتصل من جديد وأكّد البصمة"
        found = emptyList()
        screen = Screen.CONNECT
    }

    /** يوقف التنبيهات في الخلفية ويمسح الجلسة (خروج أو انتهاء أو تغيّر شهادة) */
    private fun stopAlerts() {
        loggedIn = false
        api.token = null
        prefs.token = ""
        ReadyService.stop(getApplication())
    }

    // ---------- إذن البطارية (لاستمرار التنبيهات والتطبيق مغلق) ----------
    fun checkBattery() {
        val app = getApplication<Application>()
        val pm = app.getSystemService(PowerManager::class.java)
        askBattery = !prefs.batteryAsked && !(pm?.isIgnoringBatteryOptimizations(app.packageName) ?: true)
    }
    fun batteryAnswered() { prefs.batteryAsked = true; askBattery = false }

    // ---------- صور الأصناف ----------
    fun cachedImage(path: String): ImageBitmap? = images.get(path)

    suspend fun image(path: String): ImageBitmap? {
        images.get(path)?.let { return it }
        return try {
            val bytes = api.image(path)
            val bmp = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
            if (bmp != null) images.put(path, bmp)
            bmp
        } catch (e: Exception) {
            null
        }
    }

    // ---------- التحديث ----------
    private suspend fun refreshBoard() {
        tables = api.tables()
        val r = api.ready()
        if (SeenReady.fresh(r.map { it.id }).isNotEmpty()) beep()
        ready = r
    }

    private suspend fun refreshExisting() {
        val t = target ?: return
        if (t.takeaway || t.tableId == null) return
        val id = tables.firstOrNull { it.id == t.tableId }?.orders?.firstOrNull()?.id
        existing = if (id != null) api.order(id) else null
    }

    private suspend fun poll() {
        try {
            refreshBoard()
            if (screen == Screen.ORDER) refreshExisting()
            offline = false
        } catch (e: ApiException) {
            if (e.code == 401) sessionExpired() else if (e.code == 495) pinBroken()
        } catch (e: IOException) {
            offline = true
        } catch (e: Exception) {
        }
    }

    fun refresh() {
        launchApi(false) {
            refreshBoard()
            if (screen == Screen.ORDER) refreshExisting() else { menu = api.menu() } // يجلب تغييرات «نفد» والصور
        }
    }
    fun kick() { if (loggedIn) refresh() }

    private fun beep() {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            RingtoneManager.getRingtone(getApplication<Application>(), uri)?.play()
        } catch (e: Exception) {
        }
    }

    // ---------- الطلب ----------
    fun openTable(t: TableInfo) {
        target = Target(t.id, t.name, false)
        cart = emptyList(); pendingClientId = null; existing = null; error = null
        screen = Screen.ORDER
        launchApi(false) { refreshExisting() }
    }

    fun openTakeaway() {
        target = Target(null, "سفري", true)
        cart = emptyList(); pendingClientId = null; existing = null; error = null
        screen = Screen.ORDER
    }

    fun backFromOrder() {
        if (cart.isNotEmpty()) { confirmLeave = true; return }
        leaveOrder()
    }

    fun leaveOrder() {
        confirmLeave = false; cartOpen = false; cart = emptyList(); target = null; existing = null; error = null
        screen = Screen.TABLES
        refresh()
    }

    fun addToCart(dish: Dish, variant: Variant?, picks: List<Pick>, qty: Int, note: String) {
        pendingClientId = null
        val keyPicks = picks.map { it.groupId to it.index }.toSet()
        val i = cart.indexOfFirst {
            it.dish.id == dish.id && it.variant?.id == variant?.id && it.note == note &&
                it.picks.map { p -> p.groupId to p.index }.toSet() == keyPicks
        }
        cart = if (i >= 0) {
            cart.mapIndexed { n, l -> if (n == i) l.copy(qty = minOf(99, l.qty + qty)) else l }
        } else {
            cart + CartLine(nextUid++, dish, variant, picks, minOf(99, qty), note)
        }
    }

    fun changeQty(uid: Long, d: Int) {
        pendingClientId = null
        cart = cart.mapNotNull { l ->
            if (l.uid != uid) l else l.copy(qty = minOf(99, l.qty + d)).takeIf { it.qty > 0 }
        }
        if (cart.isEmpty()) cartOpen = false
    }

    fun setNote(uid: Long, note: String) {
        pendingClientId = null
        cart = cart.map { if (it.uid == uid) it.copy(note = note.trim().take(100)) else it }
    }

    fun send() {
        val t = target ?: return
        if (cart.isEmpty() || sending) return
        val cid = pendingClientId ?: UUID.randomUUID().toString().also { pendingClientId = it }
        sending = true
        error = null
        viewModelScope.launch {
            try {
                val r = api.submit(cid, t.tableId, t.takeaway, cart)
                pendingClientId = null
                cart = emptyList(); cartOpen = false; target = null; existing = null
                notice = if (r.sent) "أُرسل إلى المطبخ ✓ (طلب #${r.order.number})"
                else "حُفظ الطلب #${r.order.number} لكنه لم يُرسل للمطبخ: ${r.sendError ?: ""}"
                screen = Screen.TABLES
                offline = false
                try { refreshBoard() } catch (e: Exception) {}
            } catch (e: ApiException) {
                pendingClientId = null
                if (e.code == 401) sessionExpired() else if (e.code == 495) pinBroken() else error = e.message
            } catch (e: IOException) {
                offline = true
                error = "تعذّر الاتصال. السلة محفوظة، أعد المحاولة"
            } catch (e: Exception) {
                error = e.message ?: "خطأ غير متوقع"
            } finally {
                sending = false
            }
        }
    }

    fun sendPending() {
        val o = existing ?: return
        launchApi { existing = api.sendPending(o.id); notice = "أُرسل للمطبخ ✓" }
    }

    fun requestBill() {
        val o = existing ?: return
        launchApi { existing = api.requestBill(o.id); notice = "تم طلب الحساب للطاولة"; refreshBoard() }
    }

    fun served(t: ReadyTicket) {
        launchApi(false) { api.served(t.id); ready = ready.filter { it.id != t.id }; refreshBoard() }
    }
}
