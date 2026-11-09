package com.restaurant.waiter.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.restaurant.waiter.data.Fmt
import com.restaurant.waiter.data.ReadyTicket
import com.restaurant.waiter.data.TableInfo
import com.restaurant.waiter.data.Tls

@Composable
fun ConnectScreen(vm: WaiterViewModel) {
    // يبحث تلقائياً عند فتح الشاشة (وبعد انتهاء أي اتصال جارٍ) ما لم نجد شيئاً بعد
    LaunchedEffect(vm.busy) { if (!vm.busy && vm.found.isEmpty() && !vm.searching && vm.trust == null) vm.search() }
    val ltr = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("تطبيق النادل", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Teal)
        Spacer(Modifier.height(8.dp))
        Text(
            "يبحث التطبيق عن جهاز الكاشير تلقائياً. يجب أن يكون الجوال على نفس الواي فاي.",
            textAlign = TextAlign.Center, color = Color.Gray,
        )
        Spacer(Modifier.height(16.dp))
        if (vm.searching) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text("جارٍ البحث عن الكاشير…", color = Color.Gray)
            }
        }
        vm.found.forEach { f ->
            Card(
                onClick = { vm.connectTo(f) }, enabled = !vm.busy,
                colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9), contentColor = Ink),
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            ) {
                Column(Modifier.fillMaxWidth().padding(14.dp)) {
                    Text(f.name.ifBlank { "الكاشير" }, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("${f.host}:${f.port}", style = ltr, color = Color.DarkGray, fontSize = 14.sp)
                    if (f.fp == vm.pinned) Text("✓ مقترن سابقاً", color = Teal, fontSize = 13.sp)
                }
            }
        }
        if (!vm.searching && vm.found.isEmpty()) {
            Text(
                "لم يُعثر على كاشير. تأكد أن البرنامج يعمل وأن «تطبيق النادل» مفعّل فيه، أو أدخل العنوان يدوياً.",
                textAlign = TextAlign.Center, color = Color.Gray, fontSize = 14.sp,
            )
        }
        OutlinedButton(onClick = { vm.search() }, enabled = !vm.searching && !vm.busy) { Text("إعادة البحث") }
        Spacer(Modifier.height(20.dp))
        Text("أو أدخل العنوان يدوياً", color = Color.Gray, fontSize = 14.sp)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = vm.server, onValueChange = { vm.server = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text("عنوان الكاشير") }, placeholder = { Text("192.168.1.20:3838") }, textStyle = ltr,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        vm.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Danger, textAlign = TextAlign.Center) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { vm.connect() }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            if (vm.busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp) else Text("اتصال", fontSize = 18.sp)
        }
    }
    vm.trust?.let { TrustDialog(it, vm) }
}

/** تأكيد بصمة الأمان بالعين: تُقارَن بما يعرضه برنامج الكاشير في صفحة «تطبيق النادل». */
@Composable
private fun TrustDialog(t: TrustRequest, vm: WaiterViewModel) {
    AlertDialog(
        onDismissRequest = { vm.cancelTrust() },
        title = { Text(if (t.changed) "⚠ تغيّرت بصمة الكاشير" else "تأكيد بصمة الأمان", color = if (t.changed) Danger else Ink) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (t.changed) "هذه البصمة تختلف عن الكاشير المقترن سابقاً. إن لم يُعاد إنشاء الشهادة في البرنامج عمداً فلا تتابع؛ قد يكون جهازاً آخر على الشبكة."
                    else "طابق البصمة أدناه مع المعروضة في برنامج الكاشير (صفحة «تطبيق النادل»). تُطلب هذه الخطوة مرة واحدة فقط.",
                )
                Spacer(Modifier.height(14.dp))
                Text(
                    Tls.pretty(t.fp),
                    style = LocalTextStyle.current.copy(textDirection = TextDirection.Ltr, fontFamily = FontFamily.Monospace),
                    fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(6.dp))
                Text(t.name.ifBlank { "الكاشير" }, color = Color.Gray, fontSize = 13.sp)
            }
        },
        confirmButton = { TextButton(onClick = { vm.confirmTrust() }) { Text("تطابق، تابع", color = if (t.changed) Danger else Teal) } },
        dismissButton = { TextButton(onClick = { vm.cancelTrust() }) { Text("إلغاء") } },
    )
}

@Composable
fun LoginScreen(vm: WaiterViewModel) {
    var sel by remember { mutableStateOf(vm.staff.firstOrNull { it.id == vm.lastUserId } ?: vm.staff.firstOrNull()) }
    var pin by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text(vm.restaurant.ifBlank { "المطعم" }, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Teal)
        Text("اختر اسمك ثم أدخل رمزك السري", color = Color.Gray)
        Spacer(Modifier.height(12.dp))
        if (vm.staff.isEmpty()) {
            Text("لا يوجد موظفون بصلاحية الطلبات. أنشئ حساب «نادل» من صفحة المستخدمين في البرنامج.", color = Danger)
        }
        LazyVerticalGrid(columns = GridCells.Adaptive(110.dp), modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(vm.staff, key = { it.id }) { s ->
                val on = s.id == sel?.id
                Card(
                    onClick = { sel = s },
                    colors = CardDefaults.cardColors(containerColor = if (on) Teal else Color(0xFFF1F5F9), contentColor = if (on) Color.White else Ink),
                    modifier = Modifier.fillMaxWidth().height(64.dp),
                ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(s.name, fontWeight = FontWeight.Bold) } }
            }
        }
        OutlinedTextField(
            value = pin, onValueChange = { pin = it.filter { c -> c.isDigit() }.take(8) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text("الرمز السري") }, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        vm.error?.let { Spacer(Modifier.height(6.dp)); Text(it, color = Danger) }
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { sel?.let { vm.login(it, pin) } }, enabled = sel != null && pin.length >= 4 && !vm.busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { if (vm.busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp) else Text("دخول", fontSize = 18.sp) }
        TextButton(onClick = { vm.toConnect() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("تغيير جهاز الكاشير") }
    }
}

@Composable
fun TablesScreen(vm: WaiterViewModel) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(Teal).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(vm.restaurant.ifBlank { "الطاولات" }, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(vm.userName, color = Color(0xFFCCFBF1), fontSize = 13.sp)
            }
            TextButton(onClick = { vm.refresh() }) { Text("تحديث", color = Color.White) }
            TextButton(onClick = { vm.logout() }) { Text("خروج", color = Color.White) }
        }
        if (vm.offline) Banner("لا يوجد اتصال بجهاز الكاشير. جارٍ إعادة المحاولة…", Danger)
        if (vm.ready.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().background(Color(0xFFDCFCE7)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("جاهز للتقديم", fontWeight = FontWeight.Bold, color = Color(0xFF166534))
                vm.ready.forEach { t -> ReadyRow(t) { vm.served(t) } }
            }
        }
        if (vm.tables.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("لا توجد طاولات. أضفها من صفحة «الطاولات» في البرنامج، أو استخدم «سفري».", color = Color.Gray, textAlign = TextAlign.Center, modifier = Modifier.padding(24.dp))
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp), modifier = Modifier.weight(1f), contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { items(vm.tables, key = { it.id }) { t -> TableCard(t) { vm.openTable(t) } } }
        }
        Button(onClick = { vm.openTakeaway() }, modifier = Modifier.fillMaxWidth().padding(12.dp).height(50.dp)) { Text("طلب سفري", fontSize = 17.sp) }
    }
}

@Composable
fun Banner(text: String, color: Color) {
    Text(text, color = Color.White, modifier = Modifier.fillMaxWidth().background(color).padding(8.dp), textAlign = TextAlign.Center, fontSize = 13.sp)
}

@Composable
private fun ReadyRow(t: ReadyTicket, onServed: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(10.dp)).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(if (t.tableLabel.isNotBlank()) t.tableLabel else t.type, fontWeight = FontWeight.Bold)
            Text(t.items.joinToString("، "), fontSize = 13.sp, color = Color.DarkGray)
        }
        Button(onClick = onServed, contentPadding = PaddingValues(horizontal = 12.dp)) { Text("تم التقديم") }
    }
}

@Composable
private fun TableCard(t: TableInfo, onClick: () -> Unit) {
    val bg = when (t.status) { "busy" -> BusyBg; "bill" -> BillBg; else -> FreeBg }
    val label = when (t.status) { "busy" -> "مشغولة"; "bill" -> "تنتظر الحساب"; else -> "فاضية" }
    Card(onClick = onClick, colors = CardDefaults.cardColors(containerColor = bg, contentColor = Ink), modifier = Modifier.fillMaxWidth().height(112.dp)) {
        Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text(t.name, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("${t.area} · ${t.seats} مقاعد", fontSize = 12.sp, color = Color.DarkGray)
            }
            Column {
                Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                if (t.status != "free") Text(Fmt.money(t.totalCents), fontSize = 13.sp)
                else t.reservation?.let { Text("حجز: $it", fontSize = 12.sp, color = Danger) }
            }
        }
    }
}
