package com.restaurant.waiter.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Teal = Color(0xFF0F766E)
val FreeBg = Color(0xFFD1FAE5)
val BusyBg = Color(0xFFFEF3C7)
val BillBg = Color(0xFFFEE2E2)
val Ink = Color(0xFF111827)
val Danger = Color(0xFFB91C1C)

@Composable
fun WaiterTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Teal,
            onPrimary = Color.White,
            secondary = Color(0xFF334155),
            error = Danger,
        ),
        content = content,
    )
}
