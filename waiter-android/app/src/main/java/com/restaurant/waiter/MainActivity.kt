package com.restaurant.waiter

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.restaurant.waiter.ui.*
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private val vm: WaiterViewModel by viewModels()
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** أندرويد 13+ يطلب إذن الإشعارات صراحة؛ بدونه لا تظهر تنبيهات «جاهز للتقديم» خارج التطبيق */
    private fun ensureNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // الشاشة لا تنطفئ أثناء الخدمة
        setContent {
            WaiterTheme {
                // الواجهة عربية من اليمين لليسار دائماً، مهما كانت لغة الجهاز
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    LaunchedEffect(vm.screen) { if (vm.screen == Screen.TABLES) ensureNotifPermission() }
                    App(vm)
                }
            }
        }
    }

    override fun onStart() { super.onStart(); vm.foreground = true; vm.kick() }
    override fun onStop() { super.onStop(); vm.foreground = false }
}

@Composable
fun App(vm: WaiterViewModel) {
    BackHandler(enabled = vm.screen == Screen.ORDER) { vm.backFromOrder() }
    BackHandler(enabled = vm.screen == Screen.LOGIN) { vm.toConnect() }
    LaunchedEffect(vm.notice) {
        if (vm.notice != null) { delay(4000); vm.notice = null }
    }
    if (vm.askBattery) BatteryDialog(vm)
    Surface(Modifier.fillMaxSize(), color = Color(0xFFF8FAFC)) {
        Box(Modifier.fillMaxSize()) {
            when (vm.screen) {
                Screen.CONNECT -> ConnectScreen(vm)
                Screen.LOGIN -> LoginScreen(vm)
                Screen.TABLES -> TablesScreen(vm)
                Screen.ORDER -> OrderScreen(vm)
            }
            vm.notice?.let {
                Text(
                    it, color = Color.White,
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp).background(Color(0xFF065F46), androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(14.dp),
                )
            }
        }
    }
}

/** لتصلك التنبيهات والتطبيق مغلق وبعد إطفاء الشاشة، يحتاج التطبيق ألا يُقيَّد بتوفير البطارية. */
@Composable
private fun BatteryDialog(vm: WaiterViewModel) {
    val ctx = LocalContext.current
    AlertDialog(
        onDismissRequest = { vm.batteryAnswered() },
        title = { Text("استمرار التنبيهات") },
        text = {
            Text(
                "لتصلك تنبيهات «جاهز للتقديم» والتطبيق مغلق أو الشاشة مطفأة، اسمح للتطبيق بتجاوز توفير البطارية. " +
                    "بعض الأجهزة (شاومي، هواوي، سامسونج…) تحتاج أيضاً السماح بالتشغيل التلقائي وعدم تقييد التطبيق من إعدادات الجهاز. يمكن تغيير ذلك لاحقاً من إعدادات الجوال.",
            )
        },
        confirmButton = {
            TextButton(onClick = {
                vm.batteryAnswered()
                try { ctx.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))) } catch (e: Exception) {}
            }) { Text("السماح") }
        },
        dismissButton = { TextButton(onClick = { vm.batteryAnswered() }) { Text("لاحقاً") } },
    )
}
