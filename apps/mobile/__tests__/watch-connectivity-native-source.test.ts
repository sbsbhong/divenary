const readRepoFile = (path: string) => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

  return fs.readFileSync(`${cwd}/../../${path}`, 'utf8');
};

describe('WatchConnectivity native source contract', () => {
  it('activates the mobile WatchConnectivity inbox during native app launch', () => {
    const appDelegate = readRepoFile('apps/mobile/ios/Divenary/AppDelegate.swift');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');

    expect(appDelegate).toContain('WatchConnectivityInbox.shared.activate()');
    expect(module).toContain('WatchConnectivityInbox.shared.activate()');
  });

  it('keeps received mobile payloads in a durable inbox until JS acknowledges them', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m');

    expect(inbox).toContain('struct PendingWatchConnectivityPayload');
    expect(inbox).toContain('UserDefaults');
    expect(inbox).toContain('payloadId');
    expect(inbox).toContain(
      'DispatchQueue(label: "com.divenary.watch-connectivity-inbox"',
    );
    expect(inbox).not.toContain('DispatchQueue.main.sync');
    expect(inbox).toContain('func acknowledge(');
    expect(inbox).toContain('func acknowledgeImported(');
    expect(inbox).toContain('didReceiveMessage message');
    expect(inbox).toContain(
      'enqueuePendingPayloadOnStateQueue(from: message)',
    );
    expect(inbox).toContain('pendingAcknowledgements');
    expect(inbox).toContain('flushPendingAcknowledgementsOnStateQueue');
    expect(inbox).toContain('connectivitySession.sendMessage(dictionary');
    expect(inbox).toContain('watchSyncAcknowledgement');
    expect(module).toContain('@objc(acknowledgePayloads:resolver:rejecter:)');
    expect(module).toContain('@objc(acknowledgeImportedPayloads:resolver:rejecter:)');
    expect(module).toContain('drainPendingPayloads { payloads in');
    expect(bridge).toContain('acknowledgePayloads');
    expect(bridge).toContain('acknowledgeImportedPayloads');
  });

  it('returns bounded descriptors and prepares large artifacts off the JS thread', () => {
    const inbox = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityInbox.swift',
    );
    const module = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityModule.swift',
    );
    const bridge = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m',
    );

    expect(inbox).toContain('.prefix(8)');
    expect(inbox).toContain('func preparePendingPayload(');
    expect(inbox).toContain('preparePendingPayloadOnStateQueue');
    expect(inbox).toContain('makePeakPreservingPreview');
    expect(inbox).toContain('preparedProfileFilePath');
    const descriptorBlock = inbox.slice(
      inbox.indexOf('var descriptorDictionary:'),
      inbox.indexOf('func preparedDictionary('),
    );
    expect(descriptorBlock).not.toContain('payloadJson');
    expect(module).toContain(
      '@objc(preparePendingPayload:resolver:rejecter:)',
    );
    expect(bridge).toContain('preparePendingPayload');
    expect(bridge).toContain('adoptPreparedProfile');
  });

  it('owns inbox and WCSession state on one deadlock-safe serial queue', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');
    const initializationBlock = inbox.slice(
      inbox.indexOf('private override init()'),
      inbox.indexOf('func activate()'),
    );
    const acknowledgeBlock = inbox.slice(
      inbox.indexOf('func acknowledge('),
      inbox.indexOf('func acknowledgeImported('),
    );
    const acknowledgePersistenceBlock = inbox.slice(
      inbox.indexOf('private func acknowledgeOnStateQueue('),
      inbox.indexOf('private func acknowledgeImportedOnStateQueue('),
    );
    const enqueueBlock = inbox.slice(
      inbox.indexOf('private func enqueuePendingPayloadOnStateQueue('),
      inbox.indexOf('private func makePendingPayload('),
    );
    const deactivateBlock = inbox.slice(
      inbox.indexOf('func sessionDidDeactivate('),
      inbox.indexOf('func sessionReachabilityDidChange('),
    );
    const reachabilityBlock = inbox.slice(
      inbox.indexOf('func sessionReachabilityDidChange('),
      inbox.indexOf('func sessionWatchStateDidChange('),
    );

    expect(inbox).toContain('DispatchSpecificKey<Void>()');
    expect(inbox).toContain('DispatchQueue.getSpecific(key: stateQueueKey)');
    expect(inbox).toContain('stateQueue.sync(execute: operation)');
    expect(inbox).toContain('performOnStateQueueSync { [weak self] in');
    expect(initializationBlock).toMatch(
      /stateQueue\.async \{ \[weak self\] in[\s\S]*self\.connectivitySession\?\.delegate = self/,
    );
    expect(
      initializationBlock.indexOf('self.pendingPlannedDivesJson ='),
    ).toBeLessThan(
      initializationBlock.indexOf('self.connectivitySession?.delegate = self'),
    );
    expect(inbox).toMatch(
      /guard let self else \{\s+completion\(\[\]\)\s+return\s+\}/,
    );
    expect(inbox).toContain(
      'let status = self?.updatePlannedDivesOnStateQueue(',
    );
    expect(inbox).toContain('completion(self?.linkedWatchInfoOnStateQueue() ?? [:])');
    expect(
      acknowledgeBlock.indexOf(
        'self?.acknowledgeOnStateQueue(payloadIds: payloadIds)',
      ),
    ).toBeLessThan(
      acknowledgeBlock.indexOf('completion()'),
    );
    expect(acknowledgePersistenceBlock).toContain('persistPendingPayloads()');
    expect(deactivateBlock).toMatch(
      /stateQueue\.async \{[^}]*session\.activate\(\)/s,
    );
    expect(reachabilityBlock).toMatch(
      /stateQueue\.async \{[^}]*guard session\.isReachable else/s,
    );
    expect(inbox).toMatch(
      /didFinish userInfoTransfer:[\s\S]*stateQueue\.async \{ \[weak self\] in[\s\S]*userInfoTransfer\.userInfo/,
    );
    expect(enqueueBlock.indexOf('let dictionary =')).toBeLessThan(
      enqueueBlock.indexOf('DispatchQueue.main.async'),
    );
    expect(enqueueBlock).toMatch(
      /DispatchQueue\.main\.async[\s\S]*NotificationCenter\.default\.post\([\s\S]*userInfo: dictionary/,
    );
    expect(enqueueBlock).not.toMatch(
      /DispatchQueue\.main\.async[\s\S]*payload\.dictionary/,
    );
    expect(module).toMatch(
      /acknowledge\(payloadIds: payloadIds\) \{\s+resolve\(nil\)/,
    );
  });

  it('uses fixed privacy-safe slow-stage measurements with a 100ms threshold', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const watchSync = readRepoFile('apps/mobile/src/states/watch-connectivity-sync.tsx');
    const accountSync = readRepoFile('apps/mobile/src/sync/account-sync-coordinator.ts');
    const measurements = `${inbox}\n${watchSync}\n${accountSync}`;

    expect(inbox).toContain('if durationMs >= 100');
    expect(watchSync).toContain('if (__DEV__ && durationMs >= 100)');
    expect(accountSync).toContain('if (__DEV__ && durationMs >= 100)');
    expect(watchSync).toContain("label: 'watch-import'");
    expect(accountSync).toContain("label: 'account-hydrate-row'");
    expect(measurements).not.toMatch(
      /\[performance\].*(payloadId|localSessionId|userId|siteName|notes|coordinates|profileBytes)/,
    );
  });

  it('moves raw watch profiles on a dedicated native utility queue', () => {
    const module = readRepoFile(
      'apps/mobile/ios/Divenary/WatchProfileStorageModule.swift',
    );
    const bridge = readRepoFile(
      'apps/mobile/ios/Divenary/WatchProfileStorageModuleBridge.m',
    );

    expect(module).toMatch(
      /DispatchQueue\(\s*label: "com\.divenary\.watch-profile-storage"/,
    );
    expect(module).toContain('@objc(writeRawProfile:payloadJson:resolver:rejecter:)');
    expect(module).toContain('@objc(readRawProfile:resolver:rejecter:)');
    expect(module).toContain(
      '@objc(copyRawProfile:destinationKey:resolver:rejecter:)',
    );
    expect(bridge).toContain('writeRawProfile');
    expect(bridge).toContain('readRawProfile');
    expect(bridge).toContain('copyRawProfile');
  });

  it('updates saved watch session sync status when WatchConnectivity finishes a transfer', () => {
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');
    const envelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');

    expect(transport).toContain('onTransferStatusChanged');
    expect(transport).toContain('connectivitySession.transferFile(');
    expect(transport).toContain('outstandingFileTransfers');
    expect(transport).toContain('sessionReachabilityDidChange');
    expect(transport).toContain('didReceiveUserInfo userInfo');
    expect(transport).toContain('didReceiveMessage message');
    expect(transport).toContain('handleAcknowledgement(userInfo: message)');
    expect(envelope).toContain('watchSyncAcknowledgement');
    expect(transport).toContain('acknowledgementKind');
    expect(store).toContain('updateSyncStatus');
    expect(store).toContain('onTransferStatusChanged');
    expect(store).toContain('syncStatus == .failed && sessions[index].syncStatus == .synced');
  });

  it('uses one immutable file transfer for every watch session size', () => {
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');
    const envelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');

    expect(envelope).toContain('fileMetadata');
    expect(transport).toContain('connectivitySession.transferFile(');
    expect(transport).not.toContain('transferUserInfo(userInfo)');
    expect(transport).toContain('didFinish fileTransfer: WCSessionFileTransfer');
    expect(inbox).toContain('didReceive file: WCSessionFile');
    expect(inbox).toMatch(
      /persistPendingFile\(\s+sourceURL: file\.fileURL,\s+metadata: metadata\s+\)/,
    );
    expect(inbox).toContain('WatchConnectivityInbox", isDirectory: true');
    expect(inbox).toContain('enqueuePendingPayloadOnStateQueue(payload)');
  });

  it('re-enqueues unsynced watch sessions after loading persisted sessions', () => {
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');

    expect(store).toContain('onActivationCompleted');
    expect(store).toContain('self?.retryPendingSyncs()');
    expect(store).toContain('retryPendingSyncs');
    expect(store).toContain('entry.displayRecord.syncStatus != .synced');
    expect(store).toContain('syncTransport.enqueue(');
    expect(store).toContain('artifact: entry.artifact');
    expect(transport).toContain('onActivationCompleted');
    expect(transport).toContain('activationState == .activated');
  });

  it('embeds the watch companion inside the iPhone app bundle', () => {
    const project = readRepoFile('apps/mobile/ios/Divenary.xcodeproj/project.pbxproj');

    expect(project).toContain('name = "Embed Watch Content";');
    expect(project).toContain('dstPath = "$(CONTENTS_FOLDER_PATH)/Watch";');
  });

  it('syncs planned dives from mobile to the watch companion', () => {
    const mobileNative = readRepoFile('apps/mobile/src/native/watch-connectivity.ts');
    const useDivePlans = readRepoFile('apps/mobile/src/states/use-dive-plans.ts');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m');
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const envelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');

    expect(mobileNative).toContain('updatePlannedWatchDives');
    expect(useDivePlans).toContain('updatePlannedWatchDives(plans');
    expect(module).toContain('@objc(updatePlannedDives:resolver:rejecter:)');
    expect(bridge).toContain('updatePlannedDives');
    expect(inbox).toContain('updateApplicationContext');
    expect(inbox).toContain('watchPlannedDives');
    expect(envelope).toContain('plannedDivesKind');
    expect(envelope).toContain('plannedDivesJsonKey');
  });

  it('publishes planned dives after WatchConnectivity activation is ready', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');

    expect(inbox).toContain('pendingPlannedDivesJson');
    expect(inbox).toContain('flushPendingPlannedDivesContextOnStateQueue()');
    expect(inbox).toContain('activationState == .activated');
    expect(inbox).toContain('func sessionReachabilityDidChange(_ session: WCSession)');
    expect(transport).toContain('session.receivedApplicationContext');
    expect(transport).toContain('handleReceivedApplicationContext(from: session)');
  });

  it('keeps the latest planned dive payload durable without queueing stale planned dive snapshots', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');

    expect(inbox).toContain('plannedDivesContextStorageKey');
    expect(inbox).toMatch(
      /self\.userDefaults\.string\(\s+forKey: Self\.plannedDivesContextStorageKey\s+\)/,
    );
    expect(inbox).toContain('userDefaults.set(plannedDivesJson, forKey: Self.plannedDivesContextStorageKey)');
    expect(inbox).toContain('NSSelectorFromString("updateApplicationContext:error:")');
    expect(inbox).toContain('AutoreleasingUnsafeMutablePointer<NSError?>');
    expect(inbox).toContain('lastPlannedDivesContextError');
    expect(inbox).toContain('connectivitySession.applicationContext[WatchConnectivityEnvelopeKey.plannedDivesJson] as? String == plannedDivesJson');
    expect(inbox).not.toContain('try connectivitySession.updateApplicationContext(context)');
    expect(inbox).not.toContain('connectivitySession.transferUserInfo(context)');
    expect(inbox).toContain('func sessionWatchStateDidChange(_ session: WCSession)');
    expect(transport).toContain('didReceiveUserInfo userInfo');
    expect(transport).toContain('handlePlannedDives(userInfo: userInfo)');
  });

  it('does not assert when planned dives are queued without an installed watch companion', () => {
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const flushBlock = inbox.slice(
      inbox.indexOf('private func flushPendingPlannedDivesContextOnStateQueue()'),
      inbox.indexOf('private func linkedWatchInfoOnStateQueue()'),
    );

    expect(flushBlock).toContain('connectivitySession.isPaired');
    expect(flushBlock).toContain('connectivitySession.isWatchAppInstalled');
    expect(flushBlock).not.toContain('assertionFailure("Failed to update watch planned dives');
  });

  it('exposes linked watch status to the settings screen', () => {
    const mobileNative = readRepoFile('apps/mobile/src/native/watch-connectivity.ts');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m');
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');

    expect(mobileNative).toContain('type LinkedWatchInfo');
    expect(mobileNative).toContain('getLinkedWatchInfo');
    expect(module).toContain('@objc(getLinkedWatchInfo:rejecter:)');
    expect(bridge).toContain('getLinkedWatchInfo');
    expect(inbox).toContain('linkedWatchInfo');
    expect(inbox).toContain('isPaired');
    expect(inbox).toContain('isWatchAppInstalled');
    expect(inbox).toContain('isReachable');
  });

  it('shows unexecuted mobile plans on watch and starts recording from a selected plan', () => {
    const model = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSession.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const recorder = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift');

    expect(model).toContain('struct WatchPlannedDive');
    expect(model).toContain('sourcePlanLocalId');
    expect(store).toContain('@Published private(set) var plannedDives');
    expect(store).toContain('replacePlannedDives');
    expect(store).toContain('markPlanExecuted');
    expect(transport).toContain('didReceiveApplicationContext applicationContext');
    expect(transport).toContain('onPlannedDivesChanged');
    expect(home).toContain('PlannedDivesSection(');
    expect(home).toContain('selectedPlanLocalId: plan.sourcePlanLocalId');
    expect(home).toContain('plan = plannedDive.preDivePlan');
    expect(home).toContain('Use Plan');
    expect(home).toContain('onSelect: apply(plannedDive:)');
    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .freedive), recordingMode: .real)');
    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .real)');
    expect(home).toContain('ForEach(plannedDives)');
    expect(home).not.toContain('PreDivePlanFields');
    expect(home).not.toContain('DiveTextField');
    expect(home).not.toContain('Stepper(');
    expect(home).not.toContain('plannedDives.prefix(3)');
    expect(home).not.toContain('RecordingView(store: store, plan: plannedDive.preDivePlan)');
    expect(recorder).toContain('sourcePlanLocalId');
  });

  it('separates real sensor recording from explicit demo capture mode', () => {
    const record = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSessionRecord.swift');
    const recorder = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift');
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const realSensor = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/RealDepthSensorProvider.swift');
    const demoSensor = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/DemoDepthSensorProvider.swift');
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const watchInfoPlist = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Info.plist');

    expect(record).toContain('enum DiveCaptureMode: String, Codable, Equatable');
    expect(record).toContain('let captureMode: DiveCaptureMode');
    expect(record).toContain('captureMode = session.captureMode.rawValue');
    expect(recorder).toContain('captureMode: DiveCaptureMode = .real');
    expect(recorder).toContain('profileStore: DiveProfileRecordingStoring');
    expect(recorder).toContain('captureMode: captureMode');
    expect(recording).toContain('enum WatchRecordingMode');
    expect(recording).toContain('case real');
    expect(recording).toContain('case demo');
    expect(recording).toContain('RealDepthSensorProvider()');
    expect(recording).toContain('DemoDepthSensorProvider()');
    expect(realSensor).toContain('CMWaterSubmersionManager');
    expect(realSensor).toContain('didUpdate measurement');
    expect(realSensor).not.toContain('TODO');
    expect(demoSensor).toContain('final class DemoDepthSensorProvider');
    expect(home).toContain('recordingMode: .real');
    expect(home).toContain('recordingMode: .demo');
    expect(home).toContain('DepthSensorAvailability.current');
    expect(home).toContain('DepthAutoLaunchAuthorization');
    expect(home).not.toContain('PreDivePlanFields');
    expect(home).not.toContain('DiveTextField');
    expect(watchInfoPlist).toContain('<key>WKBackgroundModes</key>');
    expect(watchInfoPlist).toContain('<string>underwater-depth</string>');
    expect(watchInfoPlist).toContain('<key>NSMotionUsageDescription</key>');
  });

  it('provides a shared debug watch scheme without changing the target identity', () => {
    const debugScheme = readRepoFile('apps/mobile/ios/Divenary.xcodeproj/xcshareddata/xcschemes/DivenaryWatchAppDebug.xcscheme');
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const debugVisibilityBlock = home.slice(
      home.indexOf('private var showsDebugControls: Bool'),
      home.indexOf('private var scubaStartSubtitle'),
    );

    expect(debugScheme).toContain('DivenaryWatchApp.app');
    expect(debugScheme).toContain('DIVE_WATCH_DEBUG_CONTROLS');
    expect(debugScheme).not.toContain('PRODUCT_BUNDLE_IDENTIFIER');
    expect(debugVisibilityBlock).toContain('#if DEBUG');
    expect(debugVisibilityBlock).toContain('ProcessInfo.processInfo.environment["DIVE_WATCH_DEBUG_CONTROLS"] == "1"');
    expect(home).toContain('title: "Test Freedive"');
    expect(home).toContain('title: "Test Scuba"');
    expect(home).toContain('Test Large Sync');
    expect(home).toContain('store.save(DiveSessionRecord.largeDebugFixture');
    const record = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSessionRecord.swift');
    expect(record).toContain('static func largeDebugFixture(sampleCount: Int)');
    expect(record).toContain('debugTestTag');
  });

  it('refreshes the watch home view with a top pull gesture', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift');

    expect(home).toContain('.refreshable');
    expect(home).toContain('await store.refreshFromCompanion()');
    expect(store).toContain('func refreshFromCompanion() async');
    expect(transport).toContain('func refreshPlannedDives()');
    expect(transport).toContain('handleReceivedApplicationContext(from: connectivitySession)');
  });

  it('keeps watch home focused on starting scuba and free sessions', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');

    expect(home).toContain('Scuba Start');
    expect(home).toContain('Free Session Start');
    expect(home).toContain('Demo');
    expect(home).toContain('Air · Stop 5m/3:00');
    expect(home).toContain('Supplemental log');
    expect(home).toContain('Sensor ready');
    expect(home).not.toContain('Text("Divenary")');
    expect(home).not.toContain('Label("Dive Plan", systemImage: "list.clipboard")');
    expect(home).not.toContain('private struct DivePlanSetupView');
    expect(home).not.toContain('private struct PreDivePlanFields');
    expect(home).not.toContain('Start Dive');
    expect(home).not.toContain('@State private var isPreDivePlanExpanded');
    expect(home).not.toContain('PreDivePlanForm(');
    expect(home).not.toContain('isExpanded');
  });

  it('treats mismatched explicit watch home starts as ad-hoc sessions', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const explicitStartPlan = home.slice(
      home.indexOf('private func explicitStartPlan(for diveMode: DiveMode) -> PreDivePlan'),
      home.indexOf('private func applyPreferredDiveMode()'),
    );

    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .freedive), recordingMode: .real)');
    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .scuba), recordingMode: .real)');
    expect(explicitStartPlan).toContain('plan.sourcePlanLocalId == nil || plan.diveMode == diveMode');
    expect(explicitStartPlan).toContain('next.sourcePlanLocalId = nil');
    expect(explicitStartPlan).toContain('next.title = ""');
    expect(explicitStartPlan).toContain('next.userTags = next.userTags.filter { !$0.hasPrefix("plan-") }');
  });

  it('persists the preferred watch dive mode and auto-starts recording below the depth threshold', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');

    expect(store).toContain('@Published var preferredDiveMode: DiveMode');
    expect(store).toContain('preferredDiveModeStorageKey');
    expect(store).toContain('func updatePreferredDiveMode(_ nextDiveMode: DiveMode)');
    expect(store).toContain('private static func loadPreferredDiveMode');
    expect(store).toContain('DiveMode.defaultingRemovedDiveModeToScuba');
    expect(home).toContain('DiveAutoStartMonitor()');
    expect(home).toContain('startMonitoringIfAvailable(sensorProvider: RealDepthSensorProvider())');
    expect(home).toContain('activationDepthMeters: Double = 3');
    expect(home).toContain('sample.depthMeters >= activationDepthMeters');
    expect(home).toContain('store.updatePreferredDiveMode(diveMode)');
    expect(home).toContain('store.updatePreferredDiveMode(plan.diveMode)');
    expect(home).toContain('.navigationDestination(item: $automaticDiveStartRequest)');
    expect(home).toContain('RecordingView(store: store, plan: request.plan, recordingMode: .real)');
  });

  it('does not instantiate the real depth sensor before the watch home view appears', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const homeHeader = home.slice(home.indexOf('struct HomeView: View'), home.indexOf('var body: some View'));

    expect(homeHeader).not.toContain('RealDepthSensorProvider()');
    expect(homeHeader).not.toContain('DepthSensorAvailability.current');
    expect(home).toContain('loadInitialSensorAvailability()');
    expect(home).toContain('startMonitoringIfAvailable(sensorProvider: RealDepthSensorProvider())');
  });

  it('keeps active watch dive modes to scuba and freedive with mode-specific live instruments', () => {
    const model = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSession.swift');
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const diveModeBlock = model.slice(model.indexOf('enum DiveMode'), model.indexOf('enum WaterCondition'));

    expect(diveModeBlock).toContain('enum DiveMode: String, Codable, CaseIterable, Identifiable');
    expect(diveModeBlock).toContain('case scuba');
    expect(diveModeBlock).toContain('case freedive');
    expect(diveModeBlock).not.toContain('case snorkel');
    expect(diveModeBlock).not.toContain('case pool');
    expect(diveModeBlock).not.toContain('case unknown');
    expect(model).toContain('defaultingRemovedDiveModeToScuba');
    expect(recording).toContain('FreeSurfaceReadyInstrument');
    expect(recording).toContain('FreeDiveActiveInstrument');
    expect(recording).toContain('FreeSurfaceIntervalInstrument');
    expect(recording).toContain('ScubaLiveInstrument');
    expect(recording).toContain('SafetyStopInstrument');
    expect(recording).toContain('#Preview("Stop Complete")');
    expect(recording).not.toContain('safe to ascend');
  });

  it('uses a deep blue minimal depth gauge on watch live screens', () => {
    const gauge = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/DepthGaugeRail.swift');
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const watchUiCheck = readRepoFile('apps/mobile/scripts/check-watch-ui-language.mjs');

    expect(gauge).toContain('struct DepthGaugeRail');
    expect(gauge).toContain('LinearGradient');
    expect(gauge).toContain('stopZone');
    expect(gauge).toContain('Image(systemName: "chevron.right")');
    expect(gauge).toContain('deepBlueGradient');
    expect(gauge).toContain('visibleRange');
    expect(gauge).toContain('clampedTop');
    expect(gauge).toContain('maxHeight: .infinity');
    expect(gauge).toContain('guard maxScaleMeters.isFinite else { return 1 }');
    expect(gauge).toContain('private func sanitizedDepth(_ depth: Double) -> Double');
    expect(gauge).toContain('guard depth.isFinite else { return 0 }');
    expect(recording).toContain('safetyStop: recorder.scubaSafetyStop');
    expect(recording).toContain('displayedMaxDepthMeters');
    expect(recording).toContain('ceil(max(currentDepthMeters, displayedMaxDepthMeters) / 10) * 10');
    expect(recording).toContain('stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters');
    expect(recording).toContain('targetDepthMeters: safetyStop.targetDepthMeters');
    expect(recording).toContain('DepthGaugeRail');
    expect(recording).toContain('GeometryReader { proxy in');
    expect(recording).toContain('VStack(spacing: recordingVerticalSpacing)');
    expect(recording).toContain('compactEndDiveButton');
    expect(recording).toContain('.overlay(alignment: .bottomTrailing)');
    expect(recording).toContain('recordingContentBottomPadding');
    expect(recording).toContain('recordingDisclaimer');
    expect(recording).toContain('.frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)');
    expect(recording).not.toContain('ZStack(alignment: .topLeading)');
    expect(recording).not.toContain('availableInstrumentHeight');
    expect(recording).not.toContain('recordingBottomReserveHeight');
    expect(recording).not.toContain('recordingMarkerLeadingPadding');
    expect(recording).toContain('.toolbar(.hidden, for: .navigationBar)');
    expect(watchUiCheck).toContain('ios/DivenaryWatchApp/Views/DepthGaugeRail.swift');
  });

  it('renders watch session-list sync status as a bounded readable badge', () => {
    const sessionList = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionListView.swift');

    expect(sessionList).toContain('SessionSyncStatusPill(syncStatus: session.syncStatus)');
    expect(sessionList).toContain('private struct SessionSyncStatusPill');
    expect(sessionList).toContain('syncStatus.shortLabel');
    expect(sessionList).toContain('syncStatus.tint');
    expect(sessionList).toContain('.frame(minWidth: 42');
    expect(sessionList).toContain('.accessibilityLabel(syncStatus.label)');
    expect(sessionList).not.toContain('Text(session.syncStatus.label)');
  });

  it('keeps the end-dive action out of the recording screen vertical instrument stack', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const contentBlock = recording.slice(
      recording.indexOf('private var recordingContent: some View'),
      recording.indexOf('@ViewBuilder\n    private var liveInstrument'),
    );

    expect(contentBlock).toContain('.overlay(alignment: .bottomTrailing)');
    expect(contentBlock).toContain('compactEndDiveButton');
    expect(contentBlock).toContain('recordingContentBottomPadding');
    expect(contentBlock).not.toContain('recordingControls');
    expect(recording).toContain('.allowsHitTesting(surfaceEndGate.isVisible)');
    expect(recording).toContain('.frame(minWidth: 92, minHeight: 28)');
  });

  it('keeps mode-specific live instruments honest about depth, stop state, and safety calculation scope', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const demoProvider = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/DemoDepthSensorProvider.swift');
    const watchUiCheck = readRepoFile('apps/mobile/scripts/check-watch-ui-language.mjs');
    const safetyStopRouting = recording.slice(
      recording.indexOf('private var shouldShowSafetyStopInstrument'),
      recording.indexOf('private func surfaceRestTime'),
    );
    const freeDiveActiveInstrument = recording.slice(
      recording.indexOf('private struct FreeDiveActiveInstrument'),
      recording.indexOf('private struct FreeSurfaceIntervalInstrument'),
    );
    const freeSurfaceReadyInstrument = recording.slice(
      recording.indexOf('private struct FreeSurfaceReadyInstrument'),
      recording.indexOf('private struct FreeDiveActiveInstrument'),
    );
    const freeSurfaceIntervalInstrument = recording.slice(
      recording.indexOf('private struct FreeSurfaceIntervalInstrument'),
      recording.indexOf('private struct FreeDiveSummaryInstrument'),
    );
    const freeDiveSummaryInstrument = recording.slice(
      recording.indexOf('private struct FreeDiveSummaryInstrument'),
      recording.indexOf('private struct ScubaLiveInstrument'),
    );
    const safetyStopInstrument = recording.slice(
      recording.indexOf('private struct SafetyStopInstrument'),
      recording.indexOf('private struct LiveInstrumentMetric'),
    );

    expect(safetyStopRouting).toContain('case .active, .pausedTooShallow, .completed:');
    expect(safetyStopRouting).toContain('case .pausedTooDeep, .armed, .unknown, .notRequired, .skippedOrIncomplete:');
    expect(recording).toContain('case debugTest');
    expect(recording).toContain('DiveSessionRecord.debugTestTag');
    expect(recording).toContain('recordingMode.prepare(plan: plan)');
    expect(recording).toContain('digitalCrownRotation');
    expect(recording).toContain('SurfaceEndDiveGate');
    expect(recording).toContain('surfaceEndGate.isVisible');
    expect(recording).toContain('recordingMode.usesCrownDepthControl');
    expect(recording).toContain('InstrumentDepthLayout');
    expect(recording).not.toContain('case .active, .pausedTooDeep, .pausedTooShallow, .completed:');
    expect(freeSurfaceReadyInstrument).toContain('InstrumentDepthLayout(');
    expect(freeSurfaceIntervalInstrument).toContain('InstrumentDepthLayout(');
    expect(freeDiveSummaryInstrument).toContain('InstrumentDepthLayout(');
    expect(freeDiveActiveInstrument).toContain('DepthGaugeRail(');
    expect(freeDiveActiveInstrument).toContain('max(30, ceil(max(currentDepthMeters, maxDepthMeters) / 10) * 10)');
    expect(freeDiveActiveInstrument).toContain('String(localized: "Ascent")');
    expect(freeDiveActiveInstrument).not.toContain('Current dive');
    expect(freeDiveActiveInstrument).not.toContain('Freedive training reference only.');
    expect(freeDiveActiveInstrument).not.toContain('Ascent/descent');
    expect(safetyStopInstrument).toContain('warningBand');
    expect(safetyStopInstrument).toContain('isTimerPaused');
    expect(safetyStopInstrument).toContain('value: DiveFormatters.depth(currentDepthMeters)');
    expect(safetyStopInstrument).not.toContain('Within stop zone');
    expect(safetyStopInstrument).not.toContain('Deeper than stop zone');
    expect(safetyStopInstrument).not.toContain('Shallower than stop zone');
    expect(safetyStopInstrument).not.toContain('Recommended safety stop reminder · no safety calculation');
    expect(safetyStopInstrument).toContain('ceil((max(currentDepthMeters, safetyStop.maxDepthMeters) + 2) / 2) * 2');
    expect(watchUiCheck).toContain('safe to ascend');
    expect(watchUiCheck).toContain('상승 가능');
    expect(watchUiCheck).toContain('이제 안전합니다');
    expect(watchUiCheck).toContain('안전 확보');
    expect(watchUiCheck).toContain('감압 완료');
    expect(watchUiCheck).toContain('deco clear');
    expect(watchUiCheck).toContain('ceiling clear');
    expect(demoProvider).toContain('func setDepthMeters');
    expect(demoProvider).toContain('waterTemperatureCelsius');
    expect(demoProvider).not.toContain('private func depth(for phase');
  });

  it('provides watch previews for live freedive and scuba safety stop states', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');

    expect(recording).toContain('#Preview("Free Surface Ready")');
    expect(recording).toContain('#Preview("Free Dive Active")');
    expect(recording).toContain('#Preview("Free Surface Interval")');
    expect(recording).toContain('#Preview("Scuba Active")');
    expect(recording).toContain('#Preview("Safety Stop Inside")');
    expect(recording).toContain('#Preview("Safety Stop Too Deep")');
    expect(recording).toContain('#Preview("Safety Stop Too Shallow")');
    expect(recording).toContain('#Preview("Stop Complete")');
  });

  it('marks watch sessions that exceed the 40m supported-depth boundary without dropping samples', () => {
    const record = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSessionRecord.swift');
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const generatedTypes = readRepoFile('packages/contracts/generated/typescript/index.ts');
    const generatedSwift = readRepoFile('packages/contracts/generated/swift/WatchContracts.swift');

    expect(record).toContain('enum DiveDepthSupport');
    expect(record).toContain('static let supportedWatchDepthLimitMeters = 40.0');
    expect(record).toContain('struct UnsupportedDepthRecord: Codable, Equatable');
    expect(record).toContain('let unsupportedDepth: UnsupportedDepthRecord?');
    expect(record).toContain('firstExceededAt');
    expect(record).toContain('max($0.depthMeters, $0.bucketMaxDepthMeters ?? $0.depthMeters)');
    expect(record).toContain('unsupportedDepth = RecordUnsupportedDepthPayload(record: session.unsupportedDepth)');
    expect(record).toContain('let unsupportedDepth: RecordUnsupportedDepthPayload?');
    expect(record).not.toContain('filter { $0.depthMeters <= DiveDepthSupport.supportedWatchDepthLimitMeters }');
    expect(recording).toContain('UnsupportedDepthWarning');
    expect(recording).toContain('currentDepthMeters > DiveDepthSupport.supportedWatchDepthLimitMeters');
    expect(recording).toContain('String(localized: "Outside supported depth")');
    expect(generatedTypes).toContain('unsupportedDepth?: UnsupportedDepthRecord');
    expect(generatedTypes).toContain('export interface UnsupportedDepthRecord');
    expect(generatedSwift).toContain('public struct UnsupportedDepthRecord');
  });

  it('keeps v1 safety stop data recommendation-only in watch user-facing source and payloads', () => {
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');
    const detail = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionDetailView.swift');
    const record = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSessionRecord.swift');
    const controller = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/SafetyStopController.swift');

    expect(summary).not.toContain('String(localized: "Required")');
    expect(detail).not.toContain('String(localized: "Required")');
    expect(record).toContain('enum SafetyStopRecommendationType: String, Codable, Equatable');
    expect(record).toContain('case recommended');
    expect(record).toContain('let recommendationType: SafetyStopRecommendationType');
    expect(record).toContain('recommendationType: .recommended');
    expect(record).toContain('let recommendationType: String');
    expect(record).toContain('recommendationType = record.recommendationType.rawValue');
    expect(controller).not.toContain('String(localized: "Stop not required")');
    expect(controller).toContain('String(localized: "No reminder recorded")');
  });

  it('summarizes and syncs watch sessions with mode-specific payloads', () => {
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');
    const detail = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionDetailView.swift');
    const record = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSessionRecord.swift');
    const envelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');
    const recordTests = readRepoFile('apps/mobile/ios/DivenaryWatchAppTests/DiveSessionRecordMigrationTests.swift');
    const schema = readRepoFile('packages/contracts/schemas/watch-session.schema.json');
    const schemaJson = JSON.parse(schema) as { oneOf?: Array<{ required?: string[] }> };
    const schemaModeBranches = JSON.stringify(schemaJson.oneOf ?? []);
    const generatedTypes = readRepoFile('packages/contracts/generated/typescript/index.ts');
    const sessionPayloadBlock = record.slice(
      record.indexOf('private struct RecordWatchSessionPayload'),
      record.indexOf('private struct RecordWatchFreeDivePayload'),
    );
    const summarySafetyStopBlock = summary.slice(
      summary.indexOf('private struct SafetyStopSummarySection'),
      summary.indexOf('private struct StarRatingControl'),
    );
    const detailMetadataBlock = detail.slice(
      detail.indexOf('private var metadataSection'),
      detail.indexOf('@ViewBuilder'),
    );

    expect(summary).toContain('Free Session Summary');
    expect(summary).toContain('Safety Stop Summary');
    expect(summary).toContain('commonMetricsSection');
    expect(summarySafetyStopBlock).toContain('SummaryRow(title: String(localized: "Time in zone")');
    expect(summarySafetyStopBlock).not.toContain('if safetyStop.timeInZoneSeconds > 0');
    expect(detail).toContain('Free Segment List');
    expect(detail).toContain('Safety Stop Result');
    expect(detailMetadataBlock).toContain('if session.diveMode == .scuba');
    expect(detailMetadataBlock).toContain('SummaryRow(title: String(localized: "Gas")');
    expect(envelope).toContain('try session.syncMessageData()');
    expect(record).toContain('func syncMessageData(type: String = "sessionEnded") throws -> Data');
    expect(sessionPayloadBlock).toContain('let freedive: RecordWatchFreeDivePayload?');
    expect(sessionPayloadBlock).toContain('let scuba: RecordWatchScubaPayload?');
    expect(sessionPayloadBlock).toContain('switch session.payload');
    expect(sessionPayloadBlock).toContain('case .freedive(let freeSession):');
    expect(sessionPayloadBlock).toContain('freedive = RecordWatchFreeDivePayload(session: freeSession)');
    expect(sessionPayloadBlock).toContain('scuba = nil');
    expect(sessionPayloadBlock).toContain('case .scuba(let scubaSession):');
    expect(sessionPayloadBlock).toContain('freedive = nil');
    expect(sessionPayloadBlock).toContain('scuba = RecordWatchScubaPayload(session: scubaSession)');
    expect(recordTests).toContain('testFreediveSyncMessageEncodesOnlyFreedivePayload');
    expect(recordTests).toContain('testScubaSyncMessageEncodesOnlyScubaPayload');
    expect(generatedTypes).toContain('export interface WatchSessionCommon');
    expect(generatedTypes).toContain('diveMode: "freedive"; freedive: FreeDivePayload; scuba?: never');
    expect(generatedTypes).toContain('diveMode: "scuba"; scuba: ScubaPayload; freedive?: never');
    expect(generatedTypes).not.toContain('[k: string]: unknown');
    expect(schemaModeBranches).toContain('"required":["diveMode","freedive"]');
    expect(schemaModeBranches).toContain('"required":["diveMode","scuba"]');
  });

  it('keeps watch recording state in mode-specific engines', () => {
    const recorder = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift');

    expect(recorder).toContain('FreeDiveSessionEngine');
    expect(recorder).toContain('ScubaDiveEngine');
    expect(recorder).toContain('DiveSessionRecord');
    expect(recorder).not.toContain('private func updateSafetyStop');
  });

  it('drops non-finite watch samples before they can poison persisted scuba sessions', () => {
    const sample = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DepthSample.swift');
    const recorder = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift');
    const freeEngine = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/FreeDiveSessionEngine.swift');
    const scubaEngine = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/ScubaDiveEngine.swift');

    expect(sample).toContain('var isValidRecordingSample: Bool');
    expect(sample).toContain('depthMeters.isFinite');
    expect(sample).toContain('pressureKPa.isFinite');
    expect(sample).toContain('(waterTemperatureCelsius?.isFinite ?? true)');
    expect(recorder).toContain('guard sample.isValidRecordingSample else');
    expect(freeEngine).toContain('guard sample.isValidRecordingSample else');
    expect(scubaEngine).toContain('guard sample.isValidRecordingSample else');
  });

  it('uses app-store style stars for post-dive rating fields', () => {
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');

    expect(summary).toContain('private struct StarRatingControl');
    expect(summary).toContain('Image(systemName: star <= value ? "star.fill" : "star")');
    expect(summary).toContain('StarRatingControl(title: String(localized: "Rating"), value: $rating)');
    expect(summary).toContain('StarRatingControl(title: String(localized: "Effort"), value: $perceivedExertion)');
    expect(summary).toContain('StarRatingControl(title: String(localized: "Visibility"), value: $visibilityRating)');
    expect(summary).not.toContain('Picker("Rating"');
    expect(summary).not.toContain('Picker("Exertion"');
    expect(summary).not.toContain('Picker("Visibility"');
  });
});
