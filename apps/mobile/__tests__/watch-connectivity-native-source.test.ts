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
    expect(inbox).toContain('canonicalProfileData');
    expect(inbox).toContain('import JavaScriptCore');
    expect(inbox).toContain('JSON.stringify(samples.map');
    expect(inbox).not.toContain('canonicalJSONNumber');
    expect(inbox).toContain(
      'Set(sample.keys).isSubset(of: allowedSampleKeys)',
    );
    expect(inbox).toContain('guard number >= 0 else');
    const descriptorBlock = inbox.slice(
      inbox.indexOf('var descriptorDictionary:'),
      inbox.indexOf('func preparedDictionary('),
    );
    const adoptionBlock = inbox.slice(
      inbox.indexOf('func adoptPreparedProfile('),
      inbox.indexOf('func acknowledge('),
    );
    expect(descriptorBlock).not.toContain('payloadJson');
    expect(adoptionBlock).not.toContain(
      'WatchPayloadPreparationError.invalidPayload',
    );
    expect(adoptionBlock).toContain('WatchPayloadPreparationError.io');
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
    const watchSync = readRepoFile('apps/mobile/src/states/watch-sync.tsx');
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
    expect(store).toContain('updateSyncStatuses');
    expect(store).toContain('onTransferStatusChanged');
    expect(store).toMatch(/status == \.failed && nextSessions\[index\]\.syncStatus == \.synced \? \.synced : status/);
  });

  it('persists mobile deletion commands until the Watch acknowledges exact session removal', () => {
    const module = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityModule.swift',
    );
    const bridge = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m',
    );
    const inbox = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityInbox.swift',
    );
    const envelope = readRepoFile(
      'apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift',
    );
    const transport = readRepoFile(
      'apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncTransport.swift',
    );
    const artifactStore = readRepoFile(
      'apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift',
    );
    const sessionStore = readRepoFile(
      'apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift',
    );

    expect(module).toContain('@objc(queueSessionDeletion:resolver:rejecter:)');
    expect(module).toContain(
      '@objc(listSessionDeletionAcknowledgements:rejecter:)',
    );
    expect(bridge).toContain('queueSessionDeletion');
    expect(bridge).toContain('listSessionDeletionAcknowledgements');
    expect(inbox).toContain('watchConnectivityPendingSessionDeletions');
    expect(inbox).toContain('persistPendingSessionDeletions()');
    expect(inbox).toContain('flushPendingSessionDeletionsOnStateQueue()');
    expect(inbox).toContain('outstandingUserInfoTransfers');
    expect(inbox).toContain('watchSessionDeletionAcknowledgement');
    expect(envelope).toContain('watchSessionDeletionCommand');
    expect(envelope).toContain('watchSessionDeletionAcknowledgement');
    expect(transport).toContain('onSessionDeletionRequested');
    expect(transport).toContain('cancelTransfers(localSessionId:');
    expect(transport).toContain('fileTransfer.cancel()');
    expect(transport).toContain('acknowledgeDeletion(');
    expect(artifactStore).toContain('deleted-session-ledger.json');
    expect(artifactStore).toMatch(
      /func deleteSession\(\s*localSessionId:/,
    );
    expect(artifactStore).toContain('func resumePendingDeletions()');
    expect(artifactStore).toContain('func isSessionDeleted(');
    expect(artifactStore).toMatch(
      /recordDeletionIntent[\s\S]*save\(entries: remainingEntries\)[\s\S]*removeItem/,
    );
    expect(sessionStore).toContain('profileStore.resumePendingDeletions()');
    expect(sessionStore).not.toContain(
      'try? self.profileStore.resumePendingDeletions()',
    );
    expect(sessionStore).toContain(
      'guard deletionRecoverySucceeded else',
    );
    expect(sessionStore).toContain('handleSessionDeletion');
    expect(sessionStore).toContain('sessions.removeAll');
    expect(sessionStore).not.toContain('swipeActions');
    expect(sessionStore).not.toMatch(/\.onDelete\s*\(/);
    expect(sessionStore).toContain('if try profileStore.isSessionDeleted(record.id) { continue }');
  });

  it('uses the immediate deletion channel even while a background deletion transfer is outstanding', () => {
    const inbox = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityInbox.swift',
    );
    const flushBlock = inbox.slice(
      inbox.indexOf('private func flushPendingSessionDeletionsOnStateQueue()'),
      inbox.indexOf(
        'private func handleSessionDeletionAcknowledgementOnStateQueue(',
      ),
    );

    expect(flushBlock).toMatch(
      /for deletion in pendingSessionDeletions \{[\s\S]*if connectivitySession\.isReachable \{[\s\S]*connectivitySession\.sendMessage[\s\S]*guard !outstandingCommandIds\.contains\(deletion\.commandId\) else \{[\s\S]*continue[\s\S]*\}[\s\S]*connectivitySession\.transferUserInfo/,
    );
  });

  it('retries durable deletion commands when the paired Watch state changes', () => {
    const inbox = readRepoFile(
      'apps/mobile/ios/Divenary/WatchConnectivityInbox.swift',
    );
    const watchStateBlock = inbox.slice(
      inbox.indexOf('func sessionWatchStateDidChange(_ session: WCSession)'),
      inbox.indexOf(
        'func session(_ session: WCSession, didReceiveUserInfo',
      ),
    );

    expect(watchStateBlock).toContain(
      'flushPendingSessionDeletionsOnStateQueue()',
    );
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
    const mobileNative = readRepoFile('apps/mobile/src/companion/watch-link.ts') + readRepoFile('apps/mobile/src/companion/native-watch-link.ts');
    const useDivePlans = readRepoFile('apps/mobile/src/states/use-dive-plans.ts');
    const module = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityModuleBridge.m');
    const inbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');
    const envelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');

    expect(mobileNative).toContain('updatePlannedDives');
    expect(useDivePlans).toContain('defaultWatchLink.updatePlannedDives(plans');
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
    const mobileNative = readRepoFile('apps/mobile/src/companion/watch-link.ts') + readRepoFile('apps/mobile/src/companion/native-watch-link.ts');
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
    expect(home).toContain('DivePlansView(');
    expect(home).toContain('title: "Dive Plans"');
    expect(home).toContain('selectedPlanLocalId: plan.sourcePlanLocalId');
    expect(home).toContain('plan = plannedDive.preDivePlan');
    expect(home).toContain('onSelect: apply(plannedDive:)');
    expect(home).toContain('onClearSelection: clearPlannedDive');
    expect(home).toContain('DiveFormatters.depth(plannedDive.plannedMaxDepthMeters)');
    expect(home).not.toContain('plannedMaxDepthMeters ?? 0');
    expect(home).not.toContain('PlannedDivesSection(');
    expect(home).toContain('startRealDive(mode: .freedive)');
    expect(home).toContain('startRealDive(mode: .scuba)');
    expect(home).toContain('let startPlan = explicitStartPlan(for: diveMode)');
    expect(home).toContain('realCoordinator.startManual(plan: startPlan)');
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
    const services = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift');
    const simulated = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift');
    const water = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift');
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
    expect(services).toContain('RealDepthSensorProvider(coordinator: water)');
    expect(services).toContain('DiveSessionRecorder(sensorProvider: realSensorProvider)');
    expect(recording).toMatch(/func makeSimulatedSensorProvider\(\) -> DepthSensorProvider\?\s*\{\s*guard self != \.real else \{\s*return nil/);
    expect(recording).toMatch(/case \.demo, \.debugTest:\s*return \.demo/);
    expect(simulated).toContain('precondition(recordingMode != .real, "Real recording must use the app-scoped service graph")');
    expect(simulated).toContain('recordingMode.makeSimulatedSensorProvider()');
    expect(simulated).toContain('captureMode: recordingMode.captureMode');
    expect(recording).toContain('DemoDepthSensorProvider()');
    expect(water).toContain('CMWaterSubmersionManager');
    expect(realSensor).toContain('coordinator.onSample = { [weak self] sample in');
    expect(realSensor).toContain('self?.onSample?(sample)');
    expect(water).toContain('didUpdate measurement');
    expect(realSensor).not.toContain('TODO');
    expect(demoSensor).toContain('final class DemoDepthSensorProvider');
    expect(home).toContain('RealRecordingFlowView(');
    expect(home).toContain('recorder: realRecorder');
    expect(home).toContain('coordinator: realCoordinator');
    expect(home).toContain('SimulatedRecordingFlowView(');
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
      home.indexOf('private var realRecordingFlowIsPresented'),
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

    expect(home).toContain('title: "Scuba Diving"');
    expect(home).toContain('title: "Freediving"');
    for (const title of ['Freediving', 'Scuba Diving']) {
      expect(home).toMatch(new RegExp(`StartSessionCard\\(\\s*title: "${title}",\\s*systemImage: "[^"]+",\\s*accent: DiveWatchTheme\\.\\w+,\\s*trailingSystemImage: "play.fill"`));
    }
    // Only the two real starts get a play card; Demo is a quieter secondary row near the bottom.
    expect(home.match(/trailingSystemImage: "play.fill"/g)).toHaveLength(2);
    expect(home).not.toMatch(/StartSessionCard\(\s*title: "Demo"/);
    expect(home).toMatch(/HomeRow\(\s*title: "Demo",\s*detail: String\(localized: "Simulated depth"\)/);
    expect(home.search(/HomeRow\(\s*title: "Demo"/)).toBeGreaterThan(home.indexOf('title: "Scuba Diving"'));
    expect(home).toContain('static let minimumHeight: CGFloat = 64');
    expect(home).toContain('.frame(minHeight: Self.minimumHeight)');
    expect(home).toContain('HomeSafetyFooter()');
    expect(home).toContain('Recreational capture and review. Not a certified dive computer.');
    // The latest log card on Home keeps the Demo/Test marker, so a demo never reads as a real dive.
    expect(home.slice(home.indexOf('private struct LatestSessionCard'), home.indexOf('private struct LatestMetric'))).toMatch(
      /Text\("LAST DIVE"\)[\s\S]*if let captureProvenanceLabel = session\.captureProvenanceLabel \{\s*StatusPill\(title: captureProvenanceLabel/,
    );
    // While the sensor check runs the real start cards are disabled, with no placeholder or error card.
    expect(home).toContain('if let sensorAvailability, sensorAvailability.readiness != .ready');
    expect(home.match(/\.disabled\(!canStartRealDive\)/g)).toHaveLength(2);
    expect(home).toMatch(/private var canStartRealDive: Bool \{\s*sensorAvailability\?\.canStartRealDive \?\? false/);
    expect(home).not.toContain('HomeSensorError');
    expect(home).not.toContain('accent: DiveWatchTheme.danger');
    expect(home).not.toContain('Ultra required');
    expect(home).toContain('String(localized: "Depth-capable Apple Watch required")');
    // The underwater controls guide opens from Home and shows the watchOS auto-launch status.
    expect(home).toMatch(/UnderwaterControlsView\(\s*autoLaunchStatus: autoLaunchAuthorization\.status,\s*hasActionButton: ActionButtonHint\.current\.isLikelyUltra/);
    expect(home).toMatch(/HomeRow\(\s*title: "Underwater controls",\s*detail: autoLaunchAuthorization\.statusText/);
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

    expect(home).toContain('startRealDive(mode: .freedive)');
    expect(home).toContain('startRealDive(mode: .scuba)');
    expect(home).toContain('let startPlan = explicitStartPlan(for: diveMode)');
    expect(home).toContain('realCoordinator.startManual(plan: startPlan)');
    expect(explicitStartPlan).toContain('HomePlanSelection.startPlan(plan, mode: diveMode, plannedDives: store.plannedDives)');
    expect(home).toMatch(/if next.sourcePlanLocalId != nil, next.diveMode != mode \{\s*next = PreDivePlan\(diveMode: mode\)/);
    expect(home).toContain('plannedDives.first { $0.localId == id }?.preDivePlan');
    expect(home).toContain('.onChange(of: store.plannedDives)');
  });

  it('keeps demo and debug recordings away from planned dives', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const session = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSession.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');
    const withoutPlannedDiveLink = session.slice(
      session.indexOf('var withoutPlannedDiveLink: PreDivePlan'),
      session.indexOf('private func normalizedToken'),
    );

    expect(withoutPlannedDiveLink).toContain('next.sourcePlanLocalId = nil');
    expect(withoutPlannedDiveLink).toContain('next.title = ""');
    expect(withoutPlannedDiveLink).toContain('next.userTags = userTags.filter { !$0.hasPrefix("plan-") }');
    expect(home).toMatch(/plan: explicitStartPlan\(for: \.scuba\)\.withoutPlannedDiveLink,\s*recordingMode: \.demo/);
    expect(home).toMatch(/plan: explicitStartPlan\(for: \.freedive\)\.withoutPlannedDiveLink,\s*recordingMode: \.debugTest/);
    expect(home).toMatch(/plan: explicitStartPlan\(for: \.scuba\)\.withoutPlannedDiveLink,\s*recordingMode: \.debugTest/);
    expect(store).toContain('if safeSession.captureMode == .real, let sourcePlanLocalId = safeSession.resolvedSourcePlanLocalId {');
  });

  it('persists the preferred watch dive mode and starts the armed Wet Ready mode on runtime adoption', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const store = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift');

    const coordinator = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift');
    const services = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift');
    const wetReady = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift');
    const realFlow = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift');
    const waterState = coordinator.slice(coordinator.indexOf('func receiveWaterState'), coordinator.indexOf('func selectWetReadyMode'));
    const adoption = coordinator.slice(coordinator.indexOf('private func startAdoptedSystemSession()'), coordinator.indexOf('private func preferredPlan()'));

    expect(store).toContain('@Published var preferredDiveMode: DiveMode');
    expect(store).toContain('preferredDiveModeStorageKey');
    expect(store).toContain('func updatePreferredDiveMode(_ nextDiveMode: DiveMode)');
    expect(store).toContain('private static func loadPreferredDiveMode');
    expect(store).toContain('DiveMode.defaultingRemovedDiveModeToScuba');
    expect(home).toContain('realCoordinator.receiveWaterState(water.latestState)');
    expect(home).toContain('realCoordinator.receiveWaterState(nextState)');
    expect(waterState).toContain('phase = .wetReady(mode: preferredMode())');
    expect(waterState).not.toContain('recorder.startSession');
    expect(coordinator).toContain('guard case let .wetReady(currentMode) = phase,');
    expect(coordinator).toContain('updatePreferredMode(mode)');
    expect(services).toContain('preferredMode: { store.preferredDiveMode }');
    expect(services).toContain('updatePreferredMode: store.updatePreferredDiveMode');
    expect(wetReady).toMatch(/digitalCrownRotation\(\s*\$crownValue,\s*from: 0,\s*through: 1,\s*by: 1/);
    expect(wetReady).toContain('onSelect(nextMode)');
    expect(realFlow).toContain('onSelect: coordinator.selectWetReadyMode');
    expect(coordinator).toMatch(/case \.adoptedSystemSession:\s*startAdoptedSystemSession\(\)/);
    expect(adoption).toMatch(/case \.idle:\s*plan = preferredPlan\(\)/);
    expect(adoption).toMatch(/case let \.wetReady\(mode\):\s*plan = PreDivePlan\(diveMode: mode\)\s*default:\s*return/);
    expect(adoption).toContain('guard recorder.startSession(plan: plan) else');
    expect(adoption).toContain('phase = .recording(source: .systemAutoLaunch, plan: plan)');
    expect(realFlow).toMatch(/case \.recording\(_, let plan\):\s*RecordingInstrumentView\(\s*recorder: recorder,\s*plan: plan,/);
    expect(home).toContain('store.updatePreferredDiveMode(diveMode)');
    expect(home).toContain('store.updatePreferredDiveMode(plan.diveMode)');
    expect(home).toContain('.navigationDestination(isPresented: realRecordingFlowIsPresented)');
    expect(home).toContain('get: { realCoordinator.phase.presentsRecordingFlow }');
    expect(home).not.toContain('DiveAutoStartMonitor');
    expect(coordinator).not.toContain('activationDepthMeters');
  });

  it('defers home sensor availability checks and uses the app-scoped real sensor', () => {
    const home = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/HomeView.swift');
    const services = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/DiveAppServices.swift');
    const water = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/WaterSubmersionCoordinator.swift');
    const availability = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/DepthSensorAvailability.swift');
    const homeHeader = home.slice(home.indexOf('struct HomeView: View'), home.indexOf('var body: some View'));

    expect(homeHeader).not.toContain('RealDepthSensorProvider()');
    expect(homeHeader).not.toContain('DepthSensorAvailability.current');
    expect(home).toContain('loadInitialSensorAvailability()');
    // `nil` means the check is still running; a placeholder reading as "unsupported" flashed an error card.
    expect(homeHeader).toContain('@State private var sensorAvailability: DepthSensorAvailability?');
    expect(home).not.toContain('DepthSensorAvailability.launchPlaceholder');
    expect(availability).not.toContain('launchPlaceholder');
    expect(home).toMatch(/\.onAppear \{\s*applyPreferredDiveMode\(\)\s*loadInitialSensorAvailability\(\)/);
    expect(home).toMatch(/await Task\.yield\(\)\s*sensorAvailability = DepthSensorAvailability\.current/);
    expect(services).toContain('let water = WaterSubmersionCoordinator.shared');
    expect(services).toContain('RealDepthSensorProvider(coordinator: water)');
    expect(services).toContain('water.startMonitoring()');
    expect(water).toMatch(/func startMonitoring\(\) \{\s*guard !hasStartedMonitoring else \{\s*return/);
    expect(water).toContain('guard let manager = managerFactory() else');
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
    expect(gauge).toContain('rangeMeters.isFinite ? max(1, rangeMeters) : 30');
    // The page's dive-following range applies, capped by the authorized sensor limit.
    expect(gauge).toContain('upperBound = max(1, min(range, displayLimit))');
    expect(recording).toContain('max(10, ceil((max(currentDepthMeters ?? 0, safetyStop.maxDepthMeters) + 2) / 2) * 2)');
    expect(gauge).toContain('private func sanitizedDepth(_ depth: Double) -> Double');
    expect(gauge).toContain('guard depth.isFinite else { return 0 }');
    expect(recording).toContain('safetyStop: recorder.scubaSafetyStop');
    expect(recording).toContain('displayedMaxDepthMeters');
    expect(recording).toContain('ceil(max(currentDepthMeters ?? 0, displayedMaxDepthMeters) / 10) * 10');
    expect(recording).toContain('stopZone: safetyStop.minDepthMeters...safetyStop.maxDepthMeters');
    expect(recording).toContain('targetDepthMeters: safetyStop.targetDepthMeters');
    expect(recording).toContain('DepthGaugeRail');
    expect(recording).toContain('GeometryReader { proxy in');
    expect(recording).toContain('VStack(spacing: 3)');
    expect(recording).toMatch(/LiveReadoutStatusRow\(\)[\s\S]*?pageInstrument\(page\)[\s\S]*?recordingErrorFooter/);
    expect(recording).toContain('recordingErrorFooter');
    // The fixed two-line end footer became a one-line phase hint chip (see the hint test below).
    expect(recording).toMatch(/if endControl == \.crownHint, let hint \{\s*RecordingHintBar\(hint: hint\)/);
    expect(recording).not.toContain('RecordingEndControlFooter');
    // The stack takes the system bottom inset; the margin keeps the hint chip off the rounded corners.
    expect(recording).toMatch(/\.padding\(\.bottom, 8\)\s*\.ignoresSafeArea\(\.container, edges: \.bottom\)/);
    expect(recording).not.toContain('End with the configured Action Button or by turning off Water Lock.');
    expect(recording).toContain('.frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)');
    expect(recording).not.toContain('ZStack(alignment: .topLeading)');
    expect(recording).not.toContain('availableInstrumentHeight');
    expect(recording).not.toContain('recordingBottomReserveHeight');
    expect(recording).not.toContain('recordingMarkerLeadingPadding');
    expect(recording).toContain('.toolbar(showsNavigationToolbar ? .visible : .hidden, for: .navigationBar)');
    expect(watchUiCheck).toContain('ios/DivenaryWatchApp/Views/DepthGaugeRail.swift');
  });

  it('renders watch session-list sync status as an icon with its full accessible status', () => {
    const sessionList = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionListView.swift');

    expect(sessionList).toContain('SessionSyncStatusPill(syncStatus: session.syncStatus)');
    expect(sessionList).toContain('private struct SessionSyncStatusPill');
    expect(sessionList).toContain('Image(systemName: syncStatus.symbol)');
    expect(sessionList).toContain('syncStatus.tint');
    expect(sessionList).toContain('.fixedSize()');
    expect(sessionList).toContain('.accessibilityLabel(syncStatus.label)');
    expect(sessionList).not.toContain('Text(session.syncStatus.label)');
  });

  it('keeps the end-dive action out of the recording screen vertical instrument stack', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const simulated = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift');
    const contentBlock = recording.slice(
      recording.indexOf('struct RecordingInstrumentView: View'),
      recording.indexOf('@ViewBuilder\n    private var liveInstrument'),
    );
    const toolbarBlock = simulated.slice(simulated.indexOf('.toolbar {'), simulated.indexOf('.safeAreaInset'));
    const endDive = simulated.slice(simulated.indexOf('private func endDive()'), simulated.indexOf('private func dismissSavedSummary()'));

    expect(contentBlock).toContain('liveInstrument');
    expect(contentBlock).not.toContain('compactEndDiveButton');
    expect(contentBlock).not.toContain('recordingControls');
    expect(contentBlock).not.toContain('Button(');
    expect(toolbarBlock).toContain('if recordingMode == .demo, lifecycle.showsRecordingControls');
    expect(toolbarBlock).toContain('ToolbarItem(placement: .topBarLeading)');
    expect(toolbarBlock).toContain('Image(systemName: "xmark")');
    expect(toolbarBlock).toContain('.accessibilityLabel(Text("End demo"))');
    expect(toolbarBlock).toContain('_ = endDive()');
    expect(endDive).toContain('lifecycle.handleActionButtonPress()');
    expect(endDive).toContain('if lifecycle.keepsActionButtonOverride');
    expect(endDive).not.toContain('cancelSession');
    expect(recording).toMatch(/case \.demo:\s*return \.toolbarEnd/);
    expect(recording).toMatch(/case \.debugTest:\s*return \.hidden/);
    expect(simulated).toContain('showsNavigationToolbar: recordingMode == .demo');
  });

  it('pages the real recording with a phase hint chip and never ends it by touch or crown', () => {
    const hint = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingHint.swift');
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const realFlow = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift');
    const simulated = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift');
    const project = readRepoFile('apps/mobile/ios/Divenary.xcodeproj/project.pbxproj');
    const hintBar = hint.slice(hint.indexOf('struct RecordingHintBar'), hint.indexOf('struct RecordingPageDots'));
    const pager = hint.slice(hint.indexOf('struct RealRecordingPager'), hint.indexOf('struct RecordingHintBar'));
    const endPage = recording.slice(recording.indexOf('private struct EndPageInstrument'), recording.indexOf('#if DEBUG\n#Preview'));
    const depthLayout = recording.slice(recording.indexOf('private struct InstrumentDepthLayout'), recording.indexOf('private struct LiveReadoutStatusRow'));

    expect(project).toContain('RecordingHint.swift in Sources');
    // One line per phase: underwater page, surface countdown, End page in the cycle, End page itself.
    expect(hint).toContain('String(localized: "Action ▸ Details \\(position)/\\(pageCount)")');
    expect(hint).toContain('String(localized: "End available in \\(DiveFormatters.countdown(seconds: seconds))")');
    expect(hint).toContain('String(localized: "Action ▸ End page")');
    expect(hint).toContain('String(localized: "Press to end & save")');
    expect(hint).toContain('String(localized: "Crown forward ▸ Details")');
    expect(hint).toContain('String(localized: "Crown back ▸ Live")');
    expect(hint).toContain('let input: Input = hasActionButton || page == .end || page == .switchMode ? .actionButton : .crown');
    // The chip names what the next press shows: Live goes to Details first, Details to the End page.
    expect(hint).toMatch(/case \.nextPage\(\.end, _\):\s*return String\(localized: "Action ▸ End page"\)/);
    expect(hint).toMatch(/case \.notAtSurface, \.available:\s*(\/\/.*\s*)*kind = \.nextPage\(cycle\[\(index \+ 1\) % cycle\.count\], input: \.actionButton\)/);
    expect(hint).not.toContain('endPageInCycle');
    // Turning off Water Lock ends the recording, so that note shows at the surface only.
    expect(hint).toContain('showsWaterLockNote: waterState == .notSubmerged');
    expect(hint).toContain('hasActionButton: ActionButtonHint.current.isLikelyUltra');
    expect(hintBar).not.toContain('Button(');
    expect(pager).not.toContain('Button(');
    expect(pager).toContain('pages.stepFromCrown(by: Int((newTicks - oldTicks).rounded()))');
    expect(pager).toContain('isHapticFeedbackEnabled: false');
    expect(pager).not.toMatch(/requestActionButtonEnd|handleActionButtonPress/);
    expect(pager).toContain('pages.setAlwaysOn(isLuminanceReduced)');
    expect(pager).toMatch(/private var displayedPage: RecordingPage \{\s*pages.page\s*\}/);
    const pageModel = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RecordingPageModel.swift');
    expect(pageModel).toContain('guard isRecording, !isAlwaysOn else { return page }');
    expect(pageModel).toContain('guard isRecording, !isAlwaysOn, detents != 0 else { return }');
    expect(pager).toMatch(/case let \.rejected\(reason\) = feedback\.outcome/);
    expect(realFlow).toContain('pages: coordinator.recordingPages');
    // Demo and debug keep crown depth and their own end path; only real recording pages.
    expect(simulated).not.toContain('recordingPages');
    expect(simulated).toContain('.focusable(recordingMode.controlPolicy.usesCrownDepthControl)');
    // Every page keeps the gauge, the status chip with the Demo/Test marker and the unsupported-depth marker.
    expect(depthLayout).toContain('DepthGaugeRail(');
    expect(recording.slice(recording.indexOf('private func instrumentStack'), recording.indexOf('private var recordingErrorFooter'))).toContain('LiveReadoutStatusRow()');
    expect(recording.slice(recording.indexOf('private func instrumentStack'), recording.indexOf('private var recordingErrorFooter'))).toContain('UnsupportedDepthWarning(');
    expect(recording).toMatch(/case \.live:\s*liveInstrument\s*case \.details:\s*detailsInstrument\s*case \.switchMode:\s*SwitchModePageInstrument\([\s\S]*?case \.end:\s*EndPageInstrument\(/);
    expect(endPage).toContain('InstrumentDepthLayout(');
    expect(endPage).not.toContain('Button(');
    expect(endPage).not.toContain('onTapGesture');
    // The switch page acts only on an Action Button press, like the End page.
    const switchPage = recording.slice(recording.indexOf('private struct SwitchModePageInstrument'), recording.indexOf('private struct EndPageInstrument'));
    expect(switchPage).toContain('InstrumentDepthLayout(');
    expect(switchPage).not.toContain('Button(');
    expect(switchPage).not.toContain('onTapGesture');
  });

  it('keeps one large live value, two details at most and an honest Always-On readout', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const formatters = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/DiveFormatters.swift');
    const gauge = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/DepthGaugeRail.swift');
    const depthOrTime = recording.slice(recording.indexOf('private struct DepthOrTimeMetric'), recording.indexOf('private struct DepthOrTimeSecondary'));
    const bigMetric = recording.slice(recording.indexOf('private struct BigMetricText'), recording.indexOf('private struct DepthOrTimeMetric'));
    const metric = recording.slice(recording.indexOf('private struct LiveInstrumentMetric'), recording.indexOf('private struct BigMetricText'));
    const scubaDetails = recording.slice(recording.indexOf('private struct ScubaDetailsInstrument'), recording.indexOf('private struct FreeSessionDetailsInstrument'));
    const freeDetails = recording.slice(recording.indexOf('private struct FreeSessionDetailsInstrument'), recording.indexOf('private struct EndPageInstrument'));
    const surfaceReady = recording.slice(recording.indexOf('private struct FreeSurfaceReadyInstrument'), recording.indexOf('private struct FreeDiveActiveInstrument'));
    const safetyStop = recording.slice(recording.indexOf('private struct SafetyStopInstrument'), recording.indexOf('private struct LiveInstrumentMetric'));

    // The large value is live depth only while the reading is current, otherwise the elapsed time.
    expect(depthOrTime).toMatch(/if let depthMeters \{\s*BigMetricText\(\s*value: DiveFormatters\.depthValue\(depthMeters\),\s*unit: "m"/);
    expect(depthOrTime).toContain('value: DiveFormatters.duration(time)');
    expect(formatters).toContain('guard let meters else { return "--.-" }');
    expect(formatters).toContain('.system(size: size, weight: weight, design: .rounded).monospacedDigit()');
    // The old blue stop ring is gone; the recommended stop is drawn by SafetyStopInstrument only.
    expect(formatters).not.toContain('SafetyStopRing');
    expect(bigMetric).toContain('foregroundStyle(isLuminanceReduced ? DiveWatchTheme.text : color)');
    expect(bigMetric).toContain('Text(unit)');
    // Always-On hides secondary values except depth and time; status chips and markers stay.
    expect(metric).toContain('if keepsInAlwaysOn || !isLuminanceReduced');
    expect(gauge).toContain('@Environment(\\.isLuminanceReduced) private var isLuminanceReduced');
    expect(gauge).toContain('static let layoutWidth: CGFloat = 46');
    expect(
      recording.slice(recording.indexOf('private struct LiveReadoutStatusRow'), recording.indexOf('private struct UnsupportedDepthWarning')),
    ).not.toContain('isLuminanceReduced');
    expect(scubaDetails).toContain('String(localized: "Max")');
    expect(scubaDetails).toContain('String(localized: "Temp")');
    expect(scubaDetails.match(/LiveInstrumentMetric\(/g)).toHaveLength(2);
    expect(freeDetails).toContain('caption: String(localized: "Dive count")');
    expect(freeDetails).toContain('String(localized: "Last dive")');
    expect(freeDetails).toContain('String(localized: "Longest dive")');
    expect(freeDetails.match(/LiveInstrumentMetric\(/g)).toHaveLength(2);
    expect(recording).not.toContain('Average depth');
    // Copy fixes: plain dive count, labelled depth on the recommended stop.
    expect(surfaceReady).not.toContain('/#');
    expect(surfaceReady).not.toContain('String(localized: "Mode")');
    expect(safetyStop).not.toContain('title: ""');
    expect(safetyStop).toContain('String(localized: "Timer paused")');
    expect(safetyStop).not.toContain('isLuminanceReduced');
  });

  it('chooses Wet Ready, summary and setup copy by start path without claiming the Action Button', () => {
    const wetReady = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift');
    const realFlow = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift');
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');
    const guide = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/UnderwaterControlsView.swift');
    const catalog = JSON.parse(readRepoFile('apps/mobile/ios/DivenaryWatchApp/Localizable.xcstrings')) as {
      strings: Record<
        string,
        { localizations?: Record<'en' | 'ko', { stringUnit?: { value?: string } } | undefined> }
      >;
    };
    const korean = (key: string) => catalog.strings[key]?.localizations?.ko?.stringUnit?.value;
    // Watch keys are the English source text; the shown English comes from the catalog's en value.
    const english = (key: string) => catalog.strings[key]?.localizations?.en?.stringUnit?.value;
    const startCopy = wetReady.slice(wetReady.indexOf('struct WetReadyStartGuidance'), wetReady.indexOf('struct WetReadyView'));
    const summaryHeader = summary.slice(summary.indexOf('struct SessionSummaryContent'), summary.indexOf('private var commonMetricsSection'));

    expect(startCopy).toMatch(/if autoLaunchStatus == \.active \{\s*return String\(localized: "Recording starts when watchOS starts the dive session\."\)/);
    expect(startCopy).toMatch(/if hasActionButton \{\s*return String\(localized: "If you assigned Divenary to the Action Button, press it to start recording\."\)/);
    expect(startCopy).toContain('String(localized: "Start recording from Home.")');
    expect(startCopy).toContain('String(localized: "Not recording yet")');
    expect(wetReady).toContain('Button(String(localized: "Back to Home"), action: onHome)');
    expect(wetReady).not.toContain('Underwater recording starts automatically.');
    expect(wetReady).toContain('.frame(maxWidth: .infinity, minHeight: 44)');
    expect(realFlow).toContain('autoLaunchStatus: autoLaunchStatus');
    expect(realFlow).toMatch(/onBack: coordinator\.dismissSavedSummary,\s*showsNextDiveHint: ActionButtonHint\.current\.isLikelyUltra/);
    // The summary leads with max depth and duration; the sample count lives on the detail screen.
    expect(summaryHeader).toContain('if showsNextDiveHint {\n                    NextDiveActionHint()');
    expect(summaryHeader.indexOf('"Max Depth"')).toBeLessThan(summaryHeader.indexOf('DepthProfileSparkline'));
    expect(summary).not.toContain('summary.sampleCount');
    expect(summary).not.toContain('StatusPill(title: safetyStop.status.displayText');
    expect(guide).toContain('autoLaunchStatus.displayText');
    expect(guide).toContain('If you assigned Divenary to the Action Button');
    expect(korean('Recommended stop')).toBe('권장 스탑');
    expect(korean('Recommended stop time remaining')).toBe('권장 스탑 남은 시간');
    // The recommended stop never reads as a mandatory "safety stop", even in an unused catalog entry.
    expect(korean('Safety stop planning reminder')).toBe('권장 스탑 계획 리마인더');
    expect(english('Safety stop planning reminder')).toBe('Recommended stop planning reminder');
    // Diver terms: 동작 버튼 / Action Button, 수중 잠금 / Water Lock, 디지털 크라운 / Digital Crown
    // (크라운 ▸ in the short page chips).
    expect(korean('Action ▸ Details %lld/%lld')).toBe('동작 버튼 ▸ 상세 %1$lld/%2$lld');
    expect(english('Action ▸ Details %lld/%lld')).toBe('Action Button ▸ Details %1$lld/%2$lld');
    expect(korean('Crown ▸ Details %lld/%lld')).toBe('크라운 ▸ 상세 %1$lld/%2$lld');
    expect(korean('Crown ▸ Live %lld/%lld')).toBe('크라운 ▸ 실시간 %1$lld/%2$lld');
    expect(korean('Crown forward ▸ Details')).toBe('크라운 앞으로 ▸ 상세');
    expect(korean('Crown back ▸ Live')).toBe('크라운 뒤로 ▸ 실시간');
    expect(korean('Digital Crown')).toBe('디지털 크라운');
    expect(korean('Rotate the Digital Crown to choose a mode.')).toBe('디지털 크라운을 돌려 다이빙 종류를 선택하세요.');
    // Same words as the phone: 평점 and 다시 시도.
    expect(korean('Rating')).toBe('평점');
    expect(korean('Not rated')).toBe('평점 없음');
    expect(korean('Retry')).toBe('다시 시도');
    expect(english('Retry')).toBe('Try again');
    // The countdown is until ending becomes possible, not until the recording ends.
    expect(korean('End available in %@')).toBe('기록 종료 가능까지 %@');
    expect(english('End available in %@')).toBe('Can end recording in %@');
    expect(korean('Action ▸ End page')).toBe('동작 버튼 ▸ 종료 화면');
    expect(korean('Press to end & save')).toBe('동작 버튼 ▸ 기록 종료·저장');
    expect(korean('Turning off Water Lock ends recording.')).toBe('수중 잠금을 해제하면 기록이 끝납니다.');
    // Wet Ready names a screen the watch has (the Dive screen), never "Home" or a dive session.
    expect(korean('Dive')).toBe('다이빙');
    expect(korean('Recording starts when watchOS starts the dive session.')).toBe('자동 실행이 켜져 있어 기록이 자동으로 시작됩니다.');
    expect(korean('If you assigned Divenary to the Action Button, press it to start recording.')).toBe(
      '동작 버튼에 Divenary를 지정했다면 눌러서 기록을 시작하세요.',
    );
    expect(korean('Start from Home before entering the water.')).toBe('입수 전에 다이빙 화면에서 기록을 시작하세요.');
    expect(english('Start from Home before entering the water.')).toBe('Start recording on the Dive screen before you get in.');
    // The guide states the real end guard: 3 minutes of recording and the watch out of the water.
    expect(
      english(
        'If you assigned Divenary to the Action Button, the first press starts a dive and later presses switch pages. At the surface after 3 minutes, a press on the last page ends and saves.',
      ),
    ).toContain('Once recording has run for 3 minutes and the watch is out of the water');
  });

  it('routes every watch Action Button press through one phase-aware dive action intent', () => {
    const intents = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/DiveActionButtonIntents.swift');
    const coordinator = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift');
    const pages = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RecordingPageModel.swift');
    const haptics = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/DiveHaptics.swift');
    const press = coordinator.slice(
      coordinator.indexOf('func handleActionButtonPress()'),
      coordinator.indexOf('func startFromActionButton()'),
    );
    const recordingPress = coordinator.slice(
      coordinator.indexOf('private func handleRecordingActionButtonPress()'),
      coordinator.indexOf('private func preferredPlan()'),
    );
    const hapticEvents = haptics.slice(
      haptics.indexOf('enum DiveHapticEvent'),
      haptics.indexOf('fileprivate var hapticType'),
    );
    const hapticEventCases = Array.from(hapticEvents.matchAll(/^\s*case (\w+)$/gm), (match) => match[1]);

    expect(intents).not.toContain('DivenaryEndDiveIntent');
    expect(intents).toContain('struct DivenaryStartDiveIntent: StartDiveIntent');
    expect(intents).toContain('struct DivenaryDiveActionIntent: AppIntent');
    // The Start intent result, the dive action's own result and the donation all hand over the same intent.
    expect(intents.match(/\.result\(actionButtonIntent: DivenaryDiveActionIntent\(\)\)/g)).toHaveLength(3);
    expect(intents).toMatch(/var keepsDiveActionOnButton: Bool \{\s*self != \.endRequested/);
    expect(press).toMatch(/case \.completing, \.awaitingRuntimeInvalidation:\s*outcome = \.rejected\(\.busy\)/);
    expect(recordingPress).toMatch(/guard recordingPages\.page == \.end else \{\s*return \.pageChanged\(recordingPages\.advanceFromActionButton\(\)\)/);
    expect(recordingPress).toContain('guard requestActionButtonEnd() else');
    expect(pages).toContain('static let idleReturnSeconds: TimeInterval = 10');
    // Only a press acts on the switch and End pages, so the crown never selects them.
    expect(pages).toContain('private static let crownPages: [RecordingPage] = [.live, .details]');
    expect(pages).toContain('static let modeSwitchDepthLimitMeters: Double = 1');
    expect(pages).toMatch(
      /let available = isRecording\s+&& signals\.maxDepthMeters < Self\.modeSwitchDepthLimitMeters\s+&& endAvailability != \.available/,
    );
    expect(coordinator).toContain('guard case let .recording(source, plan) = phase, recordingPages.modeSwitchAvailable else {');
    expect(hapticEventCases).toEqual(['start', 'pageChange', 'rejected', 'endRequested', 'saved']);
  });

  it('plays watch haptics only through the user-action haptic wrapper', () => {
    const nodeRequire = require as (moduleName: string) => {
      readdirSync: (dirPath: string) => string[];
    };
    const fs = nodeRequire('fs');
    const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();
    const watchRoot = 'apps/mobile/ios/DivenaryWatchApp';
    const watchSwiftFiles = ['', '/Models', '/Recording', '/Runtime', '/Sensors', '/Storage', '/Sync', '/Views'].flatMap(
      (folder) =>
        fs
          .readdirSync(`${cwd}/../../${watchRoot}${folder}`)
          .filter((name) => name.endsWith('.swift'))
          .map((name) => `${watchRoot}${folder}/${name}`),
    );

    expect(watchSwiftFiles).toContain(`${watchRoot}/Runtime/DiveHaptics.swift`);
    for (const file of watchSwiftFiles.filter((path) => !path.endsWith('/Runtime/DiveHaptics.swift'))) {
      const source = readRepoFile(file);
      expect({ file, playsHaptic: /WKInterfaceDevice\.current\(\)\.play|\.sensoryFeedback\(/.test(source) }).toEqual({
        file,
        playsHaptic: false,
      });
    }
  });

  it('keeps mode-specific live instruments honest about depth, stop state, and safety calculation scope', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const simulated = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift');
    const coordinator = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift');
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');
    const demoProvider = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sensors/DemoDepthSensorProvider.swift');
    const watchUiCheck = readRepoFile('apps/mobile/scripts/check-watch-ui-language.mjs');
    const safetyStopRouting = recording.slice(
      recording.indexOf('private var shouldShowSafetyStopInstrument'),
      recording.indexOf('private func surfaceRestTime'),
    );
    const freeDiveActiveInstrument = recording.slice(
      recording.indexOf('private struct FreeDiveActiveInstrument'),
      recording.indexOf('private struct InstrumentDepthLayout'),
    );
    const depthLayout = recording.slice(recording.indexOf('private struct InstrumentDepthLayout'), recording.indexOf('private struct UnsupportedDepthWarning'));
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
    expect(simulated).toContain('recordingMode.prepare(plan: plan)');
    expect(simulated).toContain('digitalCrownRotation');
    expect(coordinator).toContain('private let minimumHardwareEndElapsedSeconds: TimeInterval = 180');
    expect(coordinator).toMatch(/guard case \.recording = phase,\s*!isEnding,\s*recorder\.elapsedTime >= minimumHardwareEndElapsedSeconds,\s*water\.latestState == \.notSubmerged/);
    expect(coordinator).not.toContain('surfaceEndDepthMeters');
    expect(simulated).toContain('.focusable(recordingMode.controlPolicy.usesCrownDepthControl)');
    expect(recording).toMatch(/var usesCrownDepthControl: Bool \{\s*self == \.simulated/);
    expect(recording).toContain('InstrumentDepthLayout');
    expect(recording).not.toContain('case .active, .pausedTooDeep, .pausedTooShallow, .completed:');
    expect(freeSurfaceReadyInstrument).toContain('InstrumentDepthLayout(');
    expect(freeSurfaceIntervalInstrument).toContain('InstrumentDepthLayout(');
    expect(freeDiveSummaryInstrument).toContain('InstrumentDepthLayout(');
    expect(freeDiveActiveInstrument).toContain('InstrumentDepthLayout(');
    expect(depthLayout).toContain('DepthGaugeRail(');
    expect(depthLayout).toContain('depthMeters: currentDepthMeters');
    expect(freeDiveActiveInstrument).toContain('max(30, ceil(max(currentDepthMeters ?? 0, maxDepthMeters) / 10) * 10)');
    expect(freeDiveActiveInstrument).toContain('String(localized: "Ascent")');
    expect(freeDiveActiveInstrument).not.toContain('Current dive');
    expect(freeDiveActiveInstrument).not.toContain('Freedive training reference only.');
    expect(freeDiveActiveInstrument).not.toContain('Ascent/descent');
    expect(safetyStopInstrument).toContain('pausedBand');
    expect(safetyStopInstrument).toContain('isTimerPaused');
    expect(safetyStopInstrument).toContain('Text(String(localized: "Recommended stop"))');
    expect(safetyStopInstrument).toContain('DiveWatchTheme.caution');
    expect(safetyStopInstrument).not.toContain('DiveWatchTheme.danger');
    // All live recommended-stop states retain amber and explicit wording.
    expect(safetyStopInstrument).not.toContain('DiveWatchTheme.primary');
    expect(safetyStopInstrument).toContain('String(localized: "Stop complete")');
    expect(safetyStopInstrument).toContain('systemImage: "checkmark"');
    expect(safetyStopInstrument).toContain('value: DiveFormatters.duration(elapsedTime)');
    expect(safetyStopInstrument).toContain('title: String(localized: "Log time")');
    expect(safetyStopInstrument).toContain('value: DiveFormatters.depth(currentDepthMeters)');
    expect(safetyStopInstrument).not.toContain('Within stop zone');
    expect(safetyStopInstrument).not.toContain('Deeper than stop zone');
    expect(safetyStopInstrument).not.toContain('Shallower than stop zone');
    expect(safetyStopInstrument).not.toContain('Recommended safety stop reminder · no safety calculation');
    expect(safetyStopInstrument).toContain('ceil((max(currentDepthMeters ?? 0, safetyStop.maxDepthMeters) + 2) / 2) * 2');
    expect(recording).toContain('recorder.liveDepthSignal == .live ? recorder.currentDepth : nil');
    expect(recording).toContain('recorder.liveDepthSignal == .live ? recorder.latestAscentRateMetersPerMinute : nil');
    expect(recording).toContain('Text(String(localized: "Log only · Not certified"))');
    expect(recording).not.toContain('Text(DiveWatchTheme.safetyDisclaimer)');
    expect(simulated).toContain('markerTitle: recordingMode.markerTitle');
    expect(summary).toContain('Supplemental log · no safety calculation');
    expect(summary).toContain('Recommended safety stop reminder · no safety calculation');
    expect(summary).toContain('SAVED LOG ONLY. NON-CERTIFIED ASSISTANT.');
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

  it('keeps recording text readable and review summaries semantic', () => {
    const recording = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingView.swift');
    const hint = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RecordingHint.swift');
    const gauge = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/DepthGaugeRail.swift');
    const rows = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionListView.swift');
    const detail = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SessionDetailView.swift');
    const formatters = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/DiveFormatters.swift');
    for (const source of [recording, hint, gauge]) {
      expect(source).not.toMatch(/size: (?:8|9|10),/);
      expect(source).not.toMatch(/minimumScaleFactor\(0\.(?:48|65|68|7)\)/);
    }
    expect(recording).toContain('.environment(\\.recordingAuthorizedMaximum, maximumDepthMeters)');
    expect(recording).toContain('private struct RecordingSecondaryMetrics');
    expect(gauge).toContain('scale.displayedDepth(depthMeters)');
    expect(hint).toContain('kind = hasActionButton ? .pressToEnd : .waterLockToEnd');
    expect(rows).toContain('sessionAccessibilitySummary(session, summary: summary)');
    expect(rows).not.toContain('.frame(width: 62');
    expect(rows).toContain('Image(systemName: syncStatus.symbol)');
    expect(detail).toContain('VStack(alignment: .leading, spacing: 4) { headerBadges }');
    expect(formatters).toContain('profileAccessibilitySummary(samples: samples)');
    expect(formatters).toContain('@ScaledMetric');
    const wet = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/WetReadyView.swift');
    expect(wet).toContain('DiveDisclaimer()');
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
    const recorder = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift');
    const append = recorder.slice(recorder.indexOf('private func append(_ sample: DepthSample)'), recorder.indexOf('private func updateElapsedTime()'));
    const displayPolicy = recording.slice(recording.indexOf('enum RecordingDepthPolicy'), recording.indexOf('struct RecordingInstrumentView'));
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
    expect(recording).toContain('currentDepthMeters > sensorDisplayLimitMeters');
    expect(recording).toContain('RecordingDepthPolicy.sensorDisplayLimit(maximumDepthMeters: maximumDepthMeters)');
    expect(displayPolicy).toMatch(/min\(\s*maximumDepthMeters \?\? DiveDepthSupport\.supportedWatchDepthLimitMeters,\s*DiveDepthSupport\.supportedWatchDepthLimitMeters\s*\)/);
    expect(record).toContain('guard maxDepthMeters > DiveDepthSupport.supportedWatchDepthLimitMeters else');
    expect(append).toContain('publish(\\.currentDepth, sample.depthMeters)');
    expect(append).toContain('publish(\\.maxDepth, max(maxDepth, sample.depthMeters))');
    expect(append).toContain('profileSampler?.append(sample)');
    expect(append).toContain('freeEngine?.append(sample)');
    expect(append).toContain('scubaEngine?.append(sample)');
    expect(append).not.toContain('supportedWatchDepthLimitMeters');
    expect(recording).toContain('String(localized: "Outside sensor-authorized depth")');
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
      summary.indexOf('private var statusColor: Color'),
    );
    const detailMetadataBlock = detail.slice(
      detail.indexOf('private var metadataSection'),
      detail.indexOf('@ViewBuilder', detail.indexOf('private var metadataSection')),
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
    expect(recorder).toMatch(/private func append\(_ sample: DepthSample\) \{\s*guard isRecording, sample\.isValidRecordingSample else \{\s*return\s*\}\s*if let previousTimestamp = lastRawSample\?\.timestamp \?\? startedAt \{/);
    expect(freeEngine).toContain('guard sample.isValidRecordingSample else');
    expect(scubaEngine).toContain('guard sample.isValidRecordingSample else');
  });

  it('shows read-only saved summaries with toolbar back navigation after real and demo auto-save', () => {
    const summary = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SummaryView.swift');

    const realFlow = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift');
    const simulated = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift');
    const coordinator = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift');

    expect(summary).toContain('struct SavedSessionSummaryView: View');
    expect(summary).toContain('SessionSummaryContent(');
    expect(summary).toContain('statusTitle: "Saved"');
    expect(summary).toContain('footer: "Edit details on iPhone."');
    expect(summary).toMatch(/ToolbarItem\(placement: \.topBarLeading\) \{\s*Button\(action: onBack\) \{\s*Image\(systemName: "chevron.left"\)/);
    expect(summary).not.toContain('StarRatingControl');
    expect(summary).not.toContain('POST-DIVE REVIEW');
    expect(summary).not.toContain('TextField(');
    expect(summary).not.toContain('Button("Save"');
    expect(summary).not.toContain('Button("Discard"');
    expect(summary).not.toContain('Button("Done"');
    expect(realFlow).toMatch(/case \.savedSummary\(let session\):\s*SavedSessionSummaryView\(\s*session: session,\s*onBack: coordinator\.dismissSavedSummary/);
    expect(simulated).toMatch(/case \.savedSummary\(let session\):\s*SavedSessionSummaryView\(\s*session: session,\s*onBack: dismissSavedSummary/);
    expect(coordinator).toContain('phase = .completing(record: record)');
    expect(coordinator).toMatch(/guard sessionStore\.save\(record\) else \{\s*phase = \.savePersistenceError\(record: record\)\s*reportFailure\(String\(localized: "Save failed\. Your log is kept\."\)\)\s*return\s*\}\s*recorder\.resetCompletedSession\(\)\s*phase = \.savedSummary\(record: record\)/);
    expect(simulated).toMatch(/phase = \.saving\(session\)\s*guard store\.save\(session\) else \{\s*phase = \.savePersistenceError\(session\)\s*reportFailure\(String\(localized: "Save failed\. Your log is kept\."\)\)\s*return false\s*\}\s*recorder\.resetCompletedSession\(\)\s*phase = \.savedSummary\(session\)/);
    expect(realFlow).toContain('coordinator.retryCompletedSessionSave()');
    expect(simulated).toContain('if case .savePersistenceError = phase { return retryCompletedSessionSave() }');
    expect(simulated).toContain('The Action Button retries saving this demo log.');
    expect(simulated).toContain('if lifecycle.keepsActionButtonOverride { installActionButtonEndOverride() }');
    expect(summary).not.toContain('Picker("Rating"');
    expect(summary).not.toContain('Picker("Exertion"');
    expect(summary).not.toContain('Picker("Visibility"');
  });
});
