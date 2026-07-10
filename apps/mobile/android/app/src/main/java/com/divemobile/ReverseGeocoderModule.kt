package com.divemobile

import android.location.Geocoder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.Locale
import java.util.concurrent.Executors

class ReverseGeocoderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "ReverseGeocoderModule"

  @ReactMethod
  fun reverseGeocode(latitude: Double, longitude: Double, locale: String?, promise: Promise) {
    executor.execute {
      try {
        val map = Arguments.createMap()

        if (!Geocoder.isPresent()) {
          promise.resolve(map)
          return@execute
        }

        val geocoder = Geocoder(reactContext, localeFromTag(locale))
        @Suppress("DEPRECATION")
        val address = geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()

        if (address == null) {
          promise.resolve(map)
          return@execute
        }

        putIfNotBlank(map, "cityName", firstNonBlank(address.locality, address.subAdminArea, address.adminArea))
        putIfNotBlank(map, "locality", address.locality)
        putIfNotBlank(map, "subAdministrativeArea", address.subAdminArea)
        putIfNotBlank(map, "administrativeArea", address.adminArea)
        putIfNotBlank(map, "country", address.countryName)
        promise.resolve(map)
      } catch (error: Exception) {
        promise.reject("E_REVERSE_GEOCODE_FAILED", error.message, error)
      }
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  private fun localeFromTag(locale: String?): Locale {
    val normalizedLocale = locale?.trim()?.replace('_', '-')?.takeIf { it.isNotEmpty() }

    return normalizedLocale?.let(Locale::forLanguageTag) ?: Locale.getDefault()
  }

  private fun putIfNotBlank(map: WritableMap, key: String, value: String?) {
    val trimmedValue = value?.trim()

    if (!trimmedValue.isNullOrEmpty()) {
      map.putString(key, trimmedValue)
    }
  }

  private fun firstNonBlank(vararg values: String?): String? =
    values.firstOrNull { !it?.trim().isNullOrEmpty() }?.trim()
}
