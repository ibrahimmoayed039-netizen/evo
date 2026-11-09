package com.restaurant.waiter.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/** كاشير وُجد على الشبكة. fp للمطابقة فقط؛ الثقة تُبنى على مصافحة TLS لا على هذا الرد. */
data class Found(val name: String, val host: String, val port: Int, val fp: String) {
    val url get() = "https://$host:$port"
}

/**
 * العثور التلقائي على الكاشير: بث UDP «من هنا؟» على كل شبكة واي فاي للجوال، ويردّ برنامج الكاشير بمنفذه وبصمته.
 * قد لا يعمل إن كانت الشبكة تعزل الأجهزة عن بعضها (Client Isolation)؛ يبقى الإدخال اليدوي للعنوان.
 */
object Discovery {
    private const val PORT = 3839
    private const val MAGIC = "RESTAURANT-POS-WAITER?"
    private val FP = Regex("^[0-9a-f]{64}$")

    private fun targets(): List<Pair<InetAddress?, InetAddress>> {
        val out = mutableListOf<Pair<InetAddress?, InetAddress>>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val b = ia.broadcast ?: continue
                    if (ia.address is Inet4Address) out += ia.address to b
                }
            }
        } catch (e: Exception) {
        }
        if (out.isEmpty()) out += null to InetAddress.getByName("255.255.255.255")
        return out
    }

    private fun parse(p: DatagramPacket): Found? = try {
        val j = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
        val port = j.getInt("port")
        val fp = j.getString("fp")
        if (j.getString("app") != "restaurant-pos-waiter" || port !in 1..65535 || !FP.matches(fp)) null
        else Found(j.optString("name", "").take(80), p.address.hostAddress ?: "", port, fp)
    } catch (e: Exception) {
        null
    }

    private fun probeOn(local: InetAddress?, bc: InetAddress, timeoutMs: Long): List<Found> {
        val found = mutableListOf<Found>()
        val s = if (local != null) DatagramSocket(InetSocketAddress(local, 0)) else DatagramSocket()
        s.use {
            it.broadcast = true
            it.soTimeout = 300
            val data = MAGIC.toByteArray(Charsets.UTF_8)
            val limit = InetAddress.getByName("255.255.255.255")
            val end = System.currentTimeMillis() + timeoutMs
            var nextSend = 0L
            val buf = ByteArray(1024)
            while (System.currentTimeMillis() < end) {
                val now = System.currentTimeMillis()
                if (now >= nextSend) {
                    for (dst in listOf(bc, limit)) try { it.send(DatagramPacket(data, data.size, dst, PORT)) } catch (e: Exception) {}
                    nextSend = now + 900
                }
                try {
                    val p = DatagramPacket(buf, buf.size)
                    it.receive(p)
                    parse(p)?.let { f -> found += f }
                } catch (e: SocketTimeoutException) {
                }
            }
        }
        return found
    }

    suspend fun discover(timeoutMs: Long = 2500): List<Found> = withContext(Dispatchers.IO) {
        val all = coroutineScope {
            targets().map { (local, bc) -> async { try { probeOn(local, bc, timeoutMs) } catch (e: Exception) { emptyList() } } }.awaitAll()
        }.flatten()
        all.distinctBy { "${it.host}:${it.port}" }
    }
}
