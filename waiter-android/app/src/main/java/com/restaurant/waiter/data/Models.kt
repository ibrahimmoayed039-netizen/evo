package com.restaurant.waiter.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }

data class Staff(val id: String, val name: String)
data class Category(val id: String, val name: String)
data class ModOption(val index: Int, val name: String, val priceCents: Int)
data class ModGroup(val id: String, val name: String, val required: Boolean, val multi: Boolean, val options: List<ModOption>)
data class Variant(val id: String, val name: String, val priceCents: Int, val soldOut: Boolean, val isDefault: Boolean)
data class Dish(
    val id: String, val name: String, val categoryId: String, val priceCents: Int, val soldOut: Boolean,
    val variants: List<Variant>, val mods: List<ModGroup>, val image: String? = null,
) {
    val hasOptions get() = variants.size > 1 || mods.isNotEmpty()
    val fromCents get() = if (variants.size > 1) variants.minOf { it.priceCents } else priceCents
}
data class Menu(val restaurant: String, val kitchen: Boolean, val categories: List<Category>, val items: List<Dish>) {
    val hasImages get() = items.any { it.image != null }
}

data class OrderRef(val id: Long, val number: Int, val totalCents: Int)
data class TableInfo(
    val id: String, val name: String, val area: String, val seats: Int, val status: String,
    val totalCents: Int, val orders: List<OrderRef>, val reservation: String?,
)
data class OrderLine(val name: String, val qty: Int, val sentQty: Int, val totalCents: Int, val note: String, val mods: List<String>)
data class OrderInfo(
    val id: Long, val number: Int, val table: String, val type: String, val subtotalCents: Int, val totalCents: Int,
    val billRequested: Boolean, val lines: List<OrderLine>,
) {
    val hasUnsent get() = lines.any { it.sentQty < it.qty }
}
data class ReadyTicket(val id: Long, val orderNumber: Int, val tableLabel: String, val type: String, val items: List<String>)
data class SubmitResult(val order: OrderInfo, val sent: Boolean, val sendError: String?)

data class Pick(val groupId: String, val index: Int, val name: String, val priceCents: Int)
data class CartLine(val uid: Long, val dish: Dish, val variant: Variant?, val picks: List<Pick>, val qty: Int, val note: String) {
    val unitCents get() = (variant?.priceCents ?: dish.priceCents) + picks.sumOf { it.priceCents }
    val totalCents get() = unitCents * qty
    val title get() = if (variant != null) "${dish.name} · ${variant.name}" else dish.name
    val details get() = picks.joinToString("، ") { it.name }
}

object Fmt {
    var currency = "ر.س"
    fun money(cents: Int) = String.format(Locale.US, "%.2f", cents / 100.0) + " " + currency
}

// ---------- تحويل JSON ----------
fun JSONObject.toDish(): Dish {
    val vs = getJSONArray("variants").objects().map {
        Variant(it.getString("id"), it.getString("name"), it.getInt("priceCents"), it.optBoolean("soldOut"), it.optBoolean("isDefault"))
    }
    val ms = getJSONArray("mods").objects().map { g ->
        ModGroup(
            g.getString("id"), g.getString("name"), g.optBoolean("required"), g.optBoolean("multi"),
            g.getJSONArray("options").objects().mapIndexed { i, o -> ModOption(i, o.getString("name"), o.getInt("priceCents")) },
        )
    }
    val img = if (has("image") && !isNull("image")) getString("image") else null
    return Dish(getString("id"), getString("name"), getString("categoryId"), getInt("priceCents"), optBoolean("soldOut"), vs, ms, img)
}

fun JSONObject.toMenu() = Menu(
    restaurant = optString("restaurant", ""),
    kitchen = optBoolean("kitchen", true),
    categories = getJSONArray("categories").objects().map { Category(it.getString("id"), it.getString("name")) },
    items = getJSONArray("items").objects().map { it.toDish() },
)

fun JSONObject.toTable() = TableInfo(
    id = getString("id"), name = getString("name"), area = optString("area", ""), seats = optInt("seats"), status = optString("status", "free"),
    totalCents = optInt("totalCents"),
    orders = getJSONArray("orders").objects().map { OrderRef(it.getLong("id"), it.getInt("number"), it.getInt("totalCents")) },
    reservation = if (isNull("reservation")) null else getJSONObject("reservation").let { "${it.optString("name")} ${it.optString("time")}" },
)

fun JSONObject.toOrder() = OrderInfo(
    id = getLong("id"), number = getInt("number"), table = optString("table", ""), type = optString("type", ""),
    subtotalCents = optInt("subtotalCents"), totalCents = optInt("totalCents"), billRequested = !isNull("billAt"),
    lines = getJSONArray("lines").objects().map { l ->
        OrderLine(
            l.getString("name"), l.getInt("qty"), l.optInt("sentQty"), l.optInt("totalCents"), l.optString("note", ""),
            l.getJSONArray("mods").let { a -> List(a.length()) { a.getString(it) } },
        )
    },
)

fun JSONObject.toReady() = ReadyTicket(
    id = getLong("id"), orderNumber = getInt("orderNumber"), tableLabel = optString("tableLabel", ""), type = optString("type", ""),
    items = getJSONArray("items").objects().map { "${it.getInt("qty")}× ${it.getString("name")}" },
)
