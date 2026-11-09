package com.restaurant.waiter.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.restaurant.waiter.data.*

@Composable
fun OrderScreen(vm: WaiterViewModel) {
    val menu = vm.menu
    val target = vm.target
    if (menu == null || target == null) return
    var catId by remember { mutableStateOf("") }
    var optionsFor by remember { mutableStateOf<Dish?>(null) }
    val shown = menu.items.filter { catId.isEmpty() || it.categoryId == catId }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(Teal).padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { vm.backFromOrder() }) { Text("‹ رجوع", color = Color.White, fontSize = 16.sp) }
            Text(target.label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.weight(1f))
            vm.existing?.let { Text("#${it.number}", color = Color(0xFFCCFBF1), modifier = Modifier.padding(end = 12.dp)) }
        }
        if (vm.offline) Banner("لا يوجد اتصال بجهاز الكاشير", Danger)
        if (!menu.kitchen) Banner("لم تُعرَّف محطات مطبخ في البرنامج؛ لن يصل الطلب للمطبخ", Color(0xFFB45309))

        vm.existing?.let { ExistingOrder(it, vm) }

        LazyRow(contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Pill("الكل", catId.isEmpty()) { catId = "" } }
            items(menu.categories, key = { it.id }) { c -> Pill(c.name, catId == c.id) { catId = c.id } }
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(140.dp), modifier = Modifier.weight(1f), contentPadding = PaddingValues(10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(shown, key = { it.id }) { d ->
                DishCard(vm, d, withImage = menu.hasImages) {
                    if (d.hasOptions) optionsFor = d
                    else vm.addToCart(d, d.variants.firstOrNull(), emptyList(), 1, "")
                }
            }
        }

        vm.error?.let { Text(it, color = Danger, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) }
        val count = vm.cart.sumOf { it.qty }
        val total = vm.cart.sumOf { it.totalCents }
        Row(Modifier.fillMaxWidth().padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.cartOpen = true }, enabled = count > 0, modifier = Modifier.weight(1f).height(52.dp)) {
                Text(if (count > 0) "السلة ($count) · ${Fmt.money(total)}" else "السلة فارغة")
            }
            Button(onClick = { vm.send() }, enabled = count > 0 && !vm.sending, modifier = Modifier.weight(1f).height(52.dp)) {
                if (vm.sending) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("إرسال للمطبخ", fontSize = 16.sp)
            }
        }
    }

    optionsFor?.let { d -> OptionsDialog(d, onDismiss = { optionsFor = null }) { v, p, q, n -> vm.addToCart(d, v, p, q, n); optionsFor = null } }
    if (vm.cartOpen) CartDialog(vm)
    if (vm.confirmLeave) {
        AlertDialog(
            onDismissRequest = { vm.confirmLeave = false },
            title = { Text("تجاهل السلة؟") },
            text = { Text("في السلة أصناف لم تُرسل بعد. إذا خرجت ستُحذف.") },
            confirmButton = { TextButton(onClick = { vm.leaveOrder() }) { Text("خروج وحذف", color = Danger) } },
            dismissButton = { TextButton(onClick = { vm.confirmLeave = false }) { Text("بقاء") } },
        )
    }
}

@Composable
private fun Pill(text: String, on: Boolean, onClick: () -> Unit) {
    Text(
        text, color = if (on) Color.White else Ink, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.background(if (on) Teal else Color(0xFFE2E8F0), RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun DishCard(vm: WaiterViewModel, d: Dish, withImage: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick, enabled = !d.soldOut,
        colors = CardDefaults.cardColors(containerColor = if (d.soldOut) Color(0xFFF1F5F9) else Color.White, contentColor = if (d.soldOut) Color.Gray else Ink),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth().height(if (withImage) 176.dp else 92.dp),
    ) {
        Column(Modifier.fillMaxSize()) {
            // إن كان في المنيو صور فكل البطاقات بنفس الارتفاع؛ الصنف بلا صورة يظهر بحرفه الأول
            if (withImage) DishImage(vm, d.image, d.name, d.soldOut, Modifier.fillMaxWidth().height(96.dp))
            Column(Modifier.weight(1f).fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Text(d.name, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (d.soldOut) Text("نفد", color = Danger, fontWeight = FontWeight.Bold)
                else Text((if (d.variants.size > 1) "من " else "") + Fmt.money(d.fromCents), color = Teal, fontSize = 14.sp)
            }
        }
    }
}

@Composable
private fun ExistingOrder(o: OrderInfo, vm: WaiterViewModel) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(Color(0xFFFFFBEB)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Text("الطلب المفتوح: ${o.lines.sumOf { it.qty }} صنف · ${Fmt.money(o.subtotalCents)}", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text(if (open) "▲" else "▼")
        }
        if (open) {
            o.lines.forEach { l ->
                val sent = l.sentQty >= l.qty
                Text(
                    "${l.qty}× ${l.name}" + (if (l.mods.isNotEmpty()) " (${l.mods.joinToString("، ")})" else "") + (if (l.note.isNotBlank()) " — ${l.note}" else "") +
                        if (sent) "  ✓" else "  ⏳ لم يُرسل",
                    fontSize = 14.sp, color = if (sent) Color(0xFF166534) else Color(0xFFB45309),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                if (o.hasUnsent) OutlinedButton(onClick = { vm.sendPending() }, enabled = !vm.busy) { Text("إرسال غير المُرسل") }
                if (!o.billRequested) OutlinedButton(onClick = { vm.requestBill() }, enabled = !vm.busy) { Text("طلب الحساب") }
                else Text("تم طلب الحساب", color = Danger, modifier = Modifier.align(Alignment.CenterVertically))
            }
        }
    }
}

// ---------- خيارات الصنف (النوع والإضافات والكمية والملاحظة) ----------
@Composable
private fun OptionsDialog(d: Dish, onDismiss: () -> Unit, onAdd: (Variant?, List<Pick>, Int, String) -> Unit) {
    var variant by remember { mutableStateOf(d.variants.firstOrNull { it.isDefault && !it.soldOut } ?: d.variants.firstOrNull { !it.soldOut }) }
    val picks: SnapshotStateList<Pick> = remember { mutableStateListOf() }
    var qty by remember { mutableIntStateOf(1) }
    var note by remember { mutableStateOf("") }

    val missing = d.mods.firstOrNull { g -> g.required && picks.none { it.groupId == g.id } }
    val valid = missing == null && (d.variants.isEmpty() || variant != null)
    val unit = (variant?.priceCents ?: d.priceCents) + picks.sumOf { it.priceCents }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(d.name) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (d.variants.size > 1) {
                    Text("الحجم / النوع", fontWeight = FontWeight.Bold)
                    d.variants.forEach { v ->
                        Row(Modifier.fillMaxWidth().clickable(enabled = !v.soldOut) { variant = v }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = variant?.id == v.id, onClick = { if (!v.soldOut) variant = v }, enabled = !v.soldOut)
                            Text(v.name + if (v.soldOut) " (نفد)" else "", modifier = Modifier.weight(1f))
                            Text(Fmt.money(v.priceCents), color = Color.Gray)
                        }
                    }
                }
                d.mods.forEach { g ->
                    Spacer(Modifier.height(8.dp))
                    Text(g.name + if (g.required) " *" else "", fontWeight = FontWeight.Bold)
                    g.options.forEach { o ->
                        val on = picks.any { it.groupId == g.id && it.index == o.index }
                        val toggle = {
                            if (on) picks.removeAll { it.groupId == g.id && it.index == o.index }
                            else {
                                if (!g.multi) picks.removeAll { it.groupId == g.id }
                                picks.add(Pick(g.id, o.index, o.name, o.priceCents))
                            }
                            Unit
                        }
                        Row(Modifier.fillMaxWidth().clickable { toggle() }, verticalAlignment = Alignment.CenterVertically) {
                            if (g.multi) Checkbox(checked = on, onCheckedChange = { toggle() }) else RadioButton(selected = on, onClick = { toggle() })
                            Text(o.name, modifier = Modifier.weight(1f))
                            if (o.priceCents != 0) Text("+" + Fmt.money(o.priceCents), color = Color.Gray)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = note, onValueChange = { note = it.take(100) }, label = { Text("ملاحظة للمطبخ (اختياري)") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { if (qty > 1) qty-- }) { Text("−", fontSize = 18.sp) }
                    Text("$qty", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = { if (qty < 99) qty++ }) { Text("+", fontSize = 18.sp) }
                }
                if (missing != null) Text("اختر من «${missing.name}»", color = Danger, modifier = Modifier.padding(top = 6.dp))
            }
        },
        confirmButton = { Button(enabled = valid, onClick = { onAdd(variant, picks.toList(), qty, note.trim()) }) { Text("إضافة · ${Fmt.money(unit * qty)}") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

// ---------- السلة ----------
@Composable
private fun CartDialog(vm: WaiterViewModel) {
    var noteFor by remember { mutableStateOf<CartLine?>(null) }
    Dialog(onDismissRequest = { vm.cartOpen = false }) {
        Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
            Column(Modifier.padding(16.dp)) {
                Text("السلة", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(vm.cart, key = { it.uid }) { l ->
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(l.title, fontWeight = FontWeight.SemiBold)
                                    if (l.details.isNotBlank()) Text(l.details, fontSize = 13.sp, color = Color.Gray)
                                    if (l.note.isNotBlank()) Text("ملاحظة: ${l.note}", fontSize = 13.sp, color = Color(0xFFB45309))
                                }
                                Text(Fmt.money(l.totalCents), fontSize = 14.sp)
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { vm.changeQty(l.uid, -1) }, contentPadding = PaddingValues(horizontal = 14.dp)) { Text(if (l.qty == 1) "حذف" else "−") }
                                Text("${l.qty}", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                OutlinedButton(onClick = { vm.changeQty(l.uid, 1) }, contentPadding = PaddingValues(horizontal = 14.dp)) { Text("+") }
                                TextButton(onClick = { noteFor = l }) { Text(if (l.note.isBlank()) "ملاحظة" else "تعديل الملاحظة") }
                            }
                            HorizontalDivider(Modifier.padding(top = 6.dp))
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text("المجموع قبل الضريبة: ${Fmt.money(vm.cart.sumOf { it.totalCents })}", fontWeight = FontWeight.Bold)
                vm.error?.let { Text(it, color = Danger, modifier = Modifier.padding(top = 4.dp)) }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { vm.cartOpen = false }, modifier = Modifier.weight(1f)) { Text("متابعة الإضافة") }
                    Button(onClick = { vm.send() }, enabled = !vm.sending && vm.cart.isNotEmpty(), modifier = Modifier.weight(1f)) {
                        if (vm.sending) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else Text("إرسال للمطبخ")
                    }
                }
            }
        }
    }
    noteFor?.let { l ->
        var text by remember(l.uid) { mutableStateOf(l.note) }
        AlertDialog(
            onDismissRequest = { noteFor = null },
            title = { Text("ملاحظة: ${l.dish.name}") },
            text = { OutlinedTextField(value = text, onValueChange = { text = it.take(100) }, placeholder = { Text("مثال: بدون بصل") }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { Button(onClick = { vm.setNote(l.uid, text); noteFor = null }) { Text("حفظ") } },
            dismissButton = { TextButton(onClick = { noteFor = null }) { Text("إلغاء") } },
        )
    }
}
