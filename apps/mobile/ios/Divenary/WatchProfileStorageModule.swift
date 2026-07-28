import CryptoKit
import Foundation
import React

@objc(WatchProfileStorageModule)
final class WatchProfileStorageModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private let profileQueue = DispatchQueue(
    label: "com.divenary.watch-profile-storage",
    qos: .utility
  )

  @objc(writeProfile:payloadJson:resolver:rejecter:)
  func writeProfile(
    key: String,
    payloadJson: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    writeRawProfile(
      key: key,
      payloadJson: payloadJson,
      resolve: resolve,
      rejecter: reject
    )
  }

  @objc(writeRawProfile:payloadJson:resolver:rejecter:)
  func writeRawProfile(
    key: String,
    payloadJson: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    profileQueue.async {
      do {
        let data = try self.validatedProfileData(payloadJson)
        let url = try self.profileURL(for: key)
        try data.write(to: url, options: .atomic)
        resolve(key)
      } catch {
        reject("watch_profile_write_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(readProfile:resolver:rejecter:)
  func readProfile(
    key: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    readRawProfile(key: key, resolve: resolve, rejecter: reject)
  }

  @objc(readRawProfile:resolver:rejecter:)
  func readRawProfile(
    key: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    profileQueue.async {
      do {
        resolve(try String(contentsOf: self.profileURL(for: key), encoding: .utf8))
      } catch {
        reject("watch_profile_read_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(copyRawProfile:destinationKey:resolver:rejecter:)
  func copyRawProfile(
    sourceKey: String,
    destinationKey: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    profileQueue.async {
      do {
        let sourceURL = try self.profileURL(for: sourceKey)
        let destinationURL = try self.profileURL(for: destinationKey)
        let data = try Data(contentsOf: sourceURL)
        _ = try self.validatedProfileData(data)
        try data.write(to: destinationURL, options: .atomic)
        resolve(destinationKey)
      } catch {
        reject("watch_profile_copy_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(deleteProfile:resolver:rejecter:)
  func deleteProfile(
    key: String,
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    profileQueue.async {
      do {
        let url = try self.profileURL(for: key)
        if FileManager.default.fileExists(atPath: url.path) {
          try FileManager.default.removeItem(at: url)
        }
        resolve(nil)
      } catch {
        reject("watch_profile_delete_failed", error.localizedDescription, error)
      }
    }
  }

  private func validatedProfileData(_ payloadJson: String) throws -> Data {
    guard let data = payloadJson.data(using: .utf8) else {
      throw CocoaError(.fileWriteInapplicableStringEncoding)
    }
    return try validatedProfileData(data)
  }

  private func validatedProfileData(_ data: Data) throws -> Data {
    guard try JSONSerialization.jsonObject(with: data) is [Any] else {
      throw CocoaError(.fileReadCorruptFile)
    }
    return data
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
    return base.appendingPathComponent("Divenary/WatchProfiles", isDirectory: true)
  }
}
