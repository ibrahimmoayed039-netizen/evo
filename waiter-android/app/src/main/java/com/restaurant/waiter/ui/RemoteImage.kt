package com.restaurant.waiter.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** صورة صنف من الكاشير: من الذاكرة إن وُجدت، وإلا تُحمَّل مرة واحدة (الرابط يحمل رقم النسخة فتتجدد عند تغيير الصورة). */
@Composable
fun DishImage(vm: WaiterViewModel, path: String?, fallback: String, soldOut: Boolean, modifier: Modifier) {
    var bmp by remember(path) { mutableStateOf(path?.let { vm.cachedImage(it) }) }
    LaunchedEffect(path) { if (path != null && bmp == null) bmp = vm.image(path) }
    val b = bmp
    if (b != null) {
        Image(b, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier.alpha(if (soldOut) 0.35f else 1f))
    } else {
        Box(modifier.background(Color(0xFFE2E8F0)), contentAlignment = Alignment.Center) {
            Text(fallback.take(1), fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color(0xFF94A3B8))
        }
    }
}
