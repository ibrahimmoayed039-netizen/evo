package com.restaurant.waiter.data

import android.annotation.SuppressLint
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/** بصمة شهادة الكاشير غير مطابقة لما اقترن به الجهاز. */
class PinMismatchException : CertificateException("بصمة شهادة الكاشير لا تطابق المقترنة")

/**
 * الثقة بالبصمة لا بسلطة شهادات: شبكة المطعم لا يوجد فيها شهادة موقّعة من جهة معروفة.
 * أول اتصال يقرأ البصمة (Capture) ثم يؤكدها المستخدم بالعين، وبعدها كل الاتصالات (pinned) ترفض أي شهادة بغير هذه البصمة.
 */
object Tls {
    fun fingerprint(c: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(c.encoded).joinToString("") { "%02x".format(it) }

    /** نفس صيغة برنامج الكاشير: أول 20 خانة بمجموعات من 4، مثل «0307 E413 FEB4 41EB 44A8». */
    fun pretty(fp: String): String = fp.take(20).uppercase().chunked(4).joinToString(" ")

    /** يقرأ البصمة فقط ولا يثق بشيء: للاتصال الأول (ping) قبل تأكيد المستخدم، ولا يُرسَل عبره أي سر. */
    @SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
    class Capture : X509TrustManager {
        @Volatile var fp: String? = null
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            fp = chain?.firstOrNull()?.let { fingerprint(it) }
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    @SuppressLint("CustomX509TrustManager")
    private class Pinned(private val expected: String) : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val got = chain?.firstOrNull()?.let { fingerprint(it) } ?: throw PinMismatchException()
            if (!MessageDigest.isEqual(got.toByteArray(), expected.toByteArray())) throw PinMismatchException()
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private fun factory(tm: X509TrustManager): SSLSocketFactory =
        SSLContext.getInstance("TLS").apply { init(null, arrayOf(tm), SecureRandom()) }.socketFactory

    /** سياق جديد في كل مرة عمداً: لا تُستأنف جلسة TLS أُنشئت بلا تحقق (Capture) داخل اتصال مثبّت. */
    fun capturing(c: Capture): SSLSocketFactory = factory(c)

    @Volatile private var cached: Pair<String, SSLSocketFactory>? = null
    @Synchronized fun pinned(fp: String): SSLSocketFactory {
        cached?.let { if (it.first == fp) return it.second }
        return factory(Pinned(fp)).also { cached = fp to it }
    }
}
