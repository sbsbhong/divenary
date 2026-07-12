import CryptoKit
import Foundation
import React

@objc(WatchProfileStorageModule)
final class WatchProfileStorageModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(writeProfile:payloadJson:resolver:rejecter:)
  func writeProfile(
    key: String,
    payloadJson: String,
    resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      guard let data = payloadJson.data(using: .utf8) else {
        throw CocoaError(.fileWriteInapplicableStringEncoding)
      }
      let url = try profileURL(for: key)
      try data.write(to: url, options: .atomic)
      resolve(key)
    } catch {
      reject("watch_profile_write_failed", error.localizedDescription, error)
    }
  }

  @objc(readProfile:resolver:rejecter:)
  func readProfile(
    key: String,
    resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      resolve(try String(contentsOf: profileURL(for: key), encoding: .utf8))
    } catch {
      reject("watch_profile_read_failed", error.localizedDescription, error)
    }
  }

  @objc(deleteProfile:resolver:rejecter:)
  func deleteProfile(
    key: String,
    resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      let url = try profileURL(for: key)
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
      }
      resolve(nil)
    } catch {
      reject("watch_profile_delete_failed", error.localizedDescription, error)
    }
  }

  private func profileURL(for key: String) throws -> URL {
    let directory = Self.profileDirectoryURL()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent("\(digest).json")
  }

  private static func profileDirectoryURL() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return base.appendingPathComponent("DiveMobile/WatchProfiles", isDirectory: true)
  }
}
