package com.restaurant.waiter.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocketFactory

/** خطأ أعاده الخادم (رسالته عربية جاهزة للعرض). code=0 لأخطاء محلية، و495 = شهادة الكاشير تغيّرت عن المقترنة. */
class ApiException(message: String, val code: Int) : Exception(message)

/** نتيجة الاتصال الأول: بصمة الشهادة التي قدّمها الخادم (غير موثوقة بعد) + هويته. */
data class Probe(val fp: String, val name: String, val app: String)

class ApiClient {
    var base: String = ""
    /** بصمة الشهادة الموثوقة؛ كل طلب يُرفض إن قدّم الخادم شهادة بغيرها */
    var pin: String? = null
    var token: String? = null
    private val imageGate = Semaphore(4)

    private fun connection(url: String, factory: SSLSocketFactory): HttpsURLConnection {
        if (!url.startsWith("https://")) throw ApiException("الاتصال غير المشفّر غير مسموح", 0)
        val c = URL(url).openConnection() as HttpsURLConnection
        c.sslSocketFactory = factory
        // الهوية تُثبَّت بالبصمة لا باسم المضيف (عنوان IP محلي بلا شهادة من سلطة معروفة)
        c.hostnameVerifier = HostnameVerifier { _, _ -> true }
        c.connectTimeout = 4000
        c.readTimeout = 10000
        return c
    }

    private fun isPinFailure(e: Throwable): Boolean = generateSequence(e) { it.cause }.any { it is PinMismatchException }

    /** طلب خام بعد التحقق من البصمة: يعيد (رمز الحالة، البايتات). */
    private fun call(method: String, path: String, body: JSONObject?, maxBytes: Int = 4_000_000): Pair<Int, ByteArray> {
        val fp = pin ?: throw ApiException("لم تُؤكَّد بصمة الكاشير بعد", 0)
        val c = connection(base.trimEnd('/') + path, Tls.pinned(fp))
        try {
            c.requestMethod = method
            c.setRequestProperty("Accept", "application/json")
            token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            if (c.contentLength > maxBytes) throw ApiException("استجابة كبيرة جداً", 0)
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            return code to (stream?.use { it.readBytes() } ?: ByteArray(0))
        } catch (e: SSLException) {
            if (isPinFailure(e)) throw ApiException("تغيّرت شهادة الكاشير. اتصل من جديد وأكّد البصمة", 495)
            throw e
        } finally {
            c.disconnect()
        }
    }

    private suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val (code, bytes) = call(method, path, body)
        val json = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (e: Exception) { JSONObject() }
        if (code !in 200..299) throw ApiException(json.optString("error", "خطأ ($code)"), code)
        json
    }

    /** يقرأ بصمة الشهادة وهوية الخادم بلا أي ثقة ولا أسرار (ping فقط)؛ يؤكدها المستخدم قبل أي دخول. */
    suspend fun probe(url: String): Probe = withContext(Dispatchers.IO) {
        val cap = Tls.Capture()
        val c = connection(url.trimEnd('/') + "/api/ping", Tls.capturing(cap))
        try {
            c.requestMethod = "GET"
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.use { it.readBytes() }?.toString(Charsets.UTF_8) ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw ApiException(json.optString("error", "خطأ ($code)"), code)
            val fp = cap.fp ?: throw ApiException("تعذّر قراءة شهادة الكاشير", 0)
            Probe(fp, json.optString("name"), json.optString("app"))
        } catch (e: SSLException) {
            throw ApiException("تعذّر الاتصال الآمن بالكاشير. حدّث برنامج الكاشير إلى النسخة التي تدعم التشفير", 0)
        } finally {
            c.disconnect()
        }
    }

    /** بايتات صورة صنف (مسار الخادم كما جاء في المنيو)؛ 4 تحميلات متوازية كحد أقصى. */
    suspend fun image(path: String): ByteArray = imageGate.withPermit {
        withContext(Dispatchers.IO) {
            val (code, bytes) = call("GET", path, null, maxBytes = 1_000_000)
            if (code !in 200..299 || bytes.size > 1_000_000) throw ApiException("تعذّر تحميل الصورة", code)
            bytes
        }
    }

    suspend fun ping(): JSONObject = request("GET", "/api/ping")

    suspend fun staff(): List<Staff> =
        request("GET", "/api/staff").getJSONArray("staff").objects().map { Staff(it.getString("id"), it.getString("name")) }

    suspend fun login(id: String, pin: String): Pair<String, String> {
        val j = request("POST", "/api/login", JSONObject().put("id", id).put("pin", pin))
        return j.getString("token") to j.getJSONObject("user").getString("name")
    }

    suspend fun logout() { request("POST", "/api/logout", JSONObject()) }

    suspend fun menu(): Menu = request("GET", "/api/menu").toMenu()

    suspend fun tables(): List<TableInfo> = request("GET", "/api/tables").getJSONArray("tables").objects().map { it.toTable() }

    suspend fun order(id: Long): OrderInfo = request("GET", "/api/orders/$id").getJSONObject("order").toOrder()

    suspend fun ready(): List<ReadyTicket> = request("GET", "/api/ready").getJSONArray("tickets").objects().map { it.toReady() }

    suspend fun served(ticketId: Long) { request("POST", "/api/tickets/$ticketId/served", JSONObject()) }

    suspend fun requestBill(orderId: Long): OrderInfo =
        request("POST", "/api/orders/$orderId/bill", JSONObject()).getJSONObject("order").toOrder()

    suspend fun sendPending(orderId: Long): OrderInfo =
        request("POST", "/api/orders/$orderId/send", JSONObject()).getJSONObject("order").toOrder()

    /** يُنشئ الطلب أو يضيف لطلب الطاولة المفتوح، ويرسله للمطبخ. clientId يمنع التكرار عند إعادة المحاولة بعد انقطاع. */
    suspend fun submit(clientId: String, tableId: String?, takeaway: Boolean, cart: List<CartLine>): SubmitResult {
        val lines = JSONArray()
        for (l in cart) {
            val o = JSONObject().put("itemId", l.dish.id).put("qty", l.qty).put("note", l.note)
            if (l.variant != null) o.put("variantId", l.variant.id)
            val mods = JSONArray()
            for (p in l.picks) mods.put(JSONObject().put("g", p.groupId).put("o", p.index))
            o.put("mods", mods)
            lines.put(o)
        }
        val body = JSONObject().put("clientId", clientId).put("type", if (takeaway) "takeaway" else "dine_in").put("lines", lines).put("send", true)
        if (!takeaway && tableId != null) body.put("tableId", tableId)
        val j = request("POST", "/api/orders", body)
        return SubmitResult(
            order = j.getJSONObject("order").toOrder(),
            sent = j.optBoolean("sent"),
            sendError = if (j.isNull("sendError")) null else j.optString("sendError"),
        )
    }
}
