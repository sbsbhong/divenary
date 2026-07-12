Source URL: apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift
Collected: 2026-07-11
Published: 2026-07-11

# Large watch session file transfer

Watch session persistence moved to file storage so records with many depth samples can be saved, but the sync transport still Base64-encoded every JSON payload into `sendMessage` and `transferUserInfo`. Large session payloads can exceed the safe interactive/property-list message size before they ever reach the mobile durable inbox. Both automatic import and the Logbook manual watch-sync action then observe an empty inbox.

The watch transport now keeps the existing direct message and user-info path for JSON payloads up to 48 KiB. Larger JSON payloads are written to a temporary file and queued with `WCSession.transferFile`; metadata carries only the envelope kind, local session id, and sent timestamp. The mobile `WatchConnectivityInbox` reads `WCSessionFile.fileURL` during `didReceive file`, converts the contents to the existing pending payload representation, persists it, and posts the same React Native event. Import acknowledgement and repository behavior remain unchanged.

Regression coverage verifies that an 8,000-sample session exceeds the direct-message threshold, file metadata excludes the Base64 payload, and the watch/mobile native source retains the file-transfer sender and receiver paths.
