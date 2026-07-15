import CoreLocation
import Foundation
import React

@objc(ReverseGeocoderModule)
final class ReverseGeocoderModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(reverseGeocode:longitude:locale:resolver:rejecter:)
  func reverseGeocode(
    latitude: NSNumber,
    longitude: NSNumber,
    locale: NSString?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let location = CLLocation(latitude: latitude.doubleValue, longitude: longitude.doubleValue)
    let preferredLocale = locale.flatMap { Locale(identifier: String($0)) }

    CLGeocoder().reverseGeocodeLocation(location, preferredLocale: preferredLocale) { placemarks, error in
      if let error {
        reject("E_REVERSE_GEOCODE_FAILED", error.localizedDescription, error)
        return
      }

      guard let placemark = placemarks?.first else {
        resolve([String: Any]())
        return
      }

      var payload: [String: Any] = [:]
      let cityName = Self.firstNonEmpty(
        placemark.locality,
        placemark.subAdministrativeArea,
        placemark.administrativeArea
      )

      Self.set(cityName, forKey: "cityName", in: &payload)
      Self.set(placemark.locality, forKey: "locality", in: &payload)
      Self.set(placemark.subAdministrativeArea, forKey: "subAdministrativeArea", in: &payload)
      Self.set(placemark.administrativeArea, forKey: "administrativeArea", in: &payload)
      Self.set(placemark.country, forKey: "country", in: &payload)

      resolve(payload)
    }
  }

  private static func set(_ value: String?, forKey key: String, in payload: inout [String: Any]) {
    guard let trimmedValue = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmedValue.isEmpty else {
      return
    }

    payload[key] = trimmedValue
  }

  private static func firstNonEmpty(_ values: String?...) -> String? {
    values.first { value in
      guard let value else {
        return false
      }

      return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    } ?? nil
  }
}
