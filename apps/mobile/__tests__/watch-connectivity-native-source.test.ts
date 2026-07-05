const readRepoFile = (path: string) => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

  return fs.readFileSync(`${cwd}/../../${path}`, 'utf8');
};

describe('WatchConnectivity native source contract', () => {
  it('keeps received mobile payloads in a durable inbox until JS acknowledges them', () => {
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');
    const module = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModuleBridge.m');

    expect(inbox).toContain('struct PendingWatchConnectivityPayload');
    expect(inbox).toContain('UserDefaults');
    expect(inbox).toContain('payloadId');
    expect(inbox).toContain('func acknowledge(payloadIds: [String])');
    expect(inbox).toContain('func acknowledgeImported(payloadIds: [String])');
    expect(inbox).toContain('didReceiveMessage message');
    expect(inbox).toContain('enqueuePendingPayload(from: message)');
    expect(inbox).toContain('sendMessage(acknowledgement');
    expect(inbox).toContain('watchSyncAcknowledgement');
    expect(module).toContain('@objc(acknowledgePayloads:resolver:rejecter:)');
    expect(module).toContain('@objc(acknowledgeImportedPayloads:resolver:rejecter:)');
    expect(bridge).toContain('acknowledgePayloads');
    expect(bridge).toContain('acknowledgeImportedPayloads');
  });

  it('updates saved watch session sync status when WatchConnectivity finishes a transfer', () => {
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');
    const envelope = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncEnvelope.swift');
    const store = readRepoFile('apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift');

    expect(transport).toContain('onTransferStatusChanged');
    expect(transport).toContain('sendMessage(userInfo');
    expect(transport).toContain('connectivitySession.isReachable');
    expect(transport).toContain('sessionReachabilityDidChange');
    expect(transport).toContain('didFinish userInfoTransfer');
    expect(transport).toContain('didReceiveUserInfo userInfo');
    expect(transport).toContain('didReceiveMessage message');
    expect(transport).toContain('handleAcknowledgement(userInfo: message)');
    expect(envelope).toContain('watchSyncAcknowledgement');
    expect(transport).toContain('acknowledgementKind');
    expect(store).toContain('updateSyncStatus');
    expect(store).toContain('onTransferStatusChanged');
    expect(store).toContain('syncStatus == .failed && sessions[index].syncStatus == .synced');
  });

  it('re-enqueues unsynced watch sessions after loading persisted sessions', () => {
    const store = readRepoFile('apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');

    expect(store).toContain('onActivationCompleted');
    expect(store).toContain('self?.retryPendingSyncs()');
    expect(store).toContain('retryPendingSyncs');
    expect(store).toContain('session.syncStatus != .synced');
    expect(store).toContain('syncTransport.enqueue(session: session)');
    expect(transport).toContain('onActivationCompleted');
    expect(transport).toContain('activationState == .activated');
  });

  it('embeds the watch companion inside the iPhone app bundle', () => {
    const project = readRepoFile('apps/mobile/ios/DiveMobile.xcodeproj/project.pbxproj');

    expect(project).toContain('name = "Embed Watch Content";');
    expect(project).toContain('dstPath = "$(CONTENTS_FOLDER_PATH)/Watch";');
  });

  it('syncs planned dives from mobile to the watch companion', () => {
    const mobileNative = readRepoFile('apps/mobile/src/native/watch-connectivity.ts');
    const useDivePlans = readRepoFile('apps/mobile/src/states/use-dive-plans.ts');
    const module = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModuleBridge.m');
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');
    const envelope = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncEnvelope.swift');

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
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');

    expect(inbox).toContain('pendingPlannedDivesJson');
    expect(inbox).toContain('flushPendingPlannedDivesContextOnMainQueue()');
    expect(inbox).toContain('activationState == .activated');
    expect(inbox).toContain('func sessionReachabilityDidChange(_ session: WCSession)');
    expect(transport).toContain('session.receivedApplicationContext');
    expect(transport).toContain('handleReceivedApplicationContext(from: session)');
  });

  it('keeps the latest planned dive payload durable without queueing stale planned dive snapshots', () => {
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');

    expect(inbox).toContain('plannedDivesContextStorageKey');
    expect(inbox).toContain('userDefaults.string(forKey: Self.plannedDivesContextStorageKey)');
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
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');
    const flushBlock = inbox.slice(
      inbox.indexOf('private func flushPendingPlannedDivesContextOnMainQueue()'),
      inbox.indexOf('private func linkedWatchInfoOnMainQueue()'),
    );

    expect(flushBlock).toContain('connectivitySession.isPaired');
    expect(flushBlock).toContain('connectivitySession.isWatchAppInstalled');
    expect(flushBlock).not.toContain('assertionFailure("Failed to update watch planned dives');
  });

  it('exposes linked watch status to the settings screen', () => {
    const mobileNative = readRepoFile('apps/mobile/src/native/watch-connectivity.ts');
    const module = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModule.swift');
    const bridge = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityModuleBridge.m');
    const inbox = readRepoFile('apps/mobile/ios/DiveMobile/WatchConnectivityInbox.swift');

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
    const model = readRepoFile('apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift');
    const store = readRepoFile('apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');
    const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');
    const recorder = readRepoFile('apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift');

    expect(model).toContain('struct WatchPlannedDive');
    expect(model).toContain('sourcePlanLocalId');
    expect(store).toContain('@Published private(set) var plannedDives');
    expect(store).toContain('replacePlannedDives');
    expect(store).toContain('markPlanExecuted');
    expect(transport).toContain('didReceiveApplicationContext applicationContext');
    expect(transport).toContain('onPlannedDivesChanged');
    expect(home).toContain('DivePlanSetupView(store: store, plan: $plan)');
    expect(home).toContain('PlannedDivesSection(');
    expect(home).toContain('selectedPlanLocalId: plan.sourcePlanLocalId');
    expect(home).toContain('plan = plannedDive.preDivePlan');
    expect(home).toContain('Use Plan');
    expect(home).toContain('RecordingView(store: store, plan: plan)');
    expect(home).toContain('ForEach(plannedDives)');
    expect(home).not.toContain('plannedDives.prefix(3)');
    expect(home).not.toContain('RecordingView(store: store, plan: plannedDive.preDivePlan)');
    expect(recorder).toContain('sourcePlanLocalId');
  });

  it('refreshes the watch home view with a top pull gesture', () => {
    const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');
    const store = readRepoFile('apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift');
    const transport = readRepoFile('apps/mobile/ios/DiveWatchApp/Sync/WatchSyncTransport.swift');

    expect(home).toContain('.refreshable');
    expect(home).toContain('await store.refreshFromCompanion()');
    expect(store).toContain('func refreshFromCompanion() async');
    expect(transport).toContain('func refreshPlannedDives()');
    expect(transport).toContain('handleReceivedApplicationContext(from: connectivitySession)');
  });

  it('keeps watch home focused on starting scuba and free sessions', () => {
    const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');

    expect(home).toContain('Scuba Start');
    expect(home).toContain('Free Session Start');
    expect(home).toContain('Air · Stop 5m/3:00');
    expect(home).toContain('Supplemental log');
    expect(home).toContain('Label("Dive Plan", systemImage: "list.clipboard")');
    expect(home).toContain('private struct DivePlanSetupView');
    expect(home).toContain('private struct PreDivePlanFields');
    expect(home).not.toContain('Start Dive');
    expect(home).not.toContain('@State private var isPreDivePlanExpanded');
    expect(home).not.toContain('PreDivePlanForm(');
    expect(home).not.toContain('isExpanded');
  });

  it('treats mismatched explicit watch home starts as ad-hoc sessions', () => {
    const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');
    const explicitStartPlan = home.slice(
      home.indexOf('private func explicitStartPlan(for diveMode: DiveMode) -> PreDivePlan'),
      home.indexOf('private func applyPreferredDiveMode()'),
    );

    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .freedive))');
    expect(home).toContain('RecordingView(store: store, plan: explicitStartPlan(for: .scuba))');
    expect(explicitStartPlan).toContain('plan.sourcePlanLocalId == nil || plan.diveMode == diveMode');
    expect(explicitStartPlan).toContain('next.sourcePlanLocalId = nil');
    expect(explicitStartPlan).toContain('next.title = ""');
    expect(explicitStartPlan).toContain('next.userTags = next.userTags.filter { !$0.hasPrefix("plan-") }');
  });

  it('persists the preferred watch dive mode and auto-starts recording below the depth threshold', () => {
    const home = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/HomeView.swift');
    const store = readRepoFile('apps/mobile/ios/DiveWatchApp/Storage/DiveSessionStore.swift');

    expect(store).toContain('@Published var preferredDiveMode: DiveMode');
    expect(store).toContain('preferredDiveModeStorageKey');
    expect(store).toContain('func updatePreferredDiveMode(_ nextDiveMode: DiveMode)');
    expect(store).toContain('private static func loadPreferredDiveMode');
    expect(store).toContain('DiveMode.defaultingRemovedDiveModeToScuba');
    expect(home).toContain('DiveAutoStartMonitor(sensorProvider: RealDepthSensorProvider())');
    expect(home).toContain('activationDepthMeters: Double = 3');
    expect(home).toContain('sample.depthMeters >= activationDepthMeters');
    expect(home).toContain('store.updatePreferredDiveMode(nextMode)');
    expect(home).toContain('.navigationDestination(item: $automaticDiveStartRequest)');
    expect(home).toContain('RecordingView(store: store, plan: request.plan)');
  });

  it('keeps active watch dive modes to scuba and freedive with mode-specific recording surfaces', () => {
    const model = readRepoFile('apps/mobile/ios/DiveWatchApp/Models/DiveSession.swift');
    const recording = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift');
    const diveModeBlock = model.slice(model.indexOf('enum DiveMode'), model.indexOf('enum WaterCondition'));

    expect(diveModeBlock).toContain('enum DiveMode: String, Codable, CaseIterable, Identifiable');
    expect(diveModeBlock).toContain('case scuba');
    expect(diveModeBlock).toContain('case freedive');
    expect(diveModeBlock).not.toContain('case snorkel');
    expect(diveModeBlock).not.toContain('case pool');
    expect(diveModeBlock).not.toContain('case unknown');
    expect(model).toContain('defaultingRemovedDiveModeToScuba');
    expect(recording).toContain('ScubaRecordingStatus');
    expect(recording).toContain('FreediveRecordingStatus');
    expect(recording).toContain('Air scuba reminder, not a dive computer.');
    expect(recording).toContain('Freedive training reference only.');
  });

  it('uses a deep blue minimal depth gauge on watch live screens', () => {
    const gauge = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/DepthGaugeRail.swift');
    const recording = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/RecordingView.swift');
    const watchUiCheck = readRepoFile('apps/mobile/scripts/check-watch-ui-language.mjs');

    expect(gauge).toContain('struct DepthGaugeRail');
    expect(gauge).toContain('LinearGradient');
    expect(gauge).toContain('stopZone');
    expect(gauge).toContain('Image(systemName: "chevron.right")');
    expect(gauge).toContain('deepBlueGradient');
    expect(gauge).toContain('visibleRange');
    expect(gauge).toContain('clampedTop');
    expect(gauge).toContain('guard maxScaleMeters.isFinite else { return 1 }');
    expect(gauge).toContain('private func sanitizedDepth(_ depth: Double) -> Double');
    expect(gauge).toContain('guard depth.isFinite else { return 0 }');
    expect(recording).toContain('safetyStopActive: recorder.safetyStopActive');
    expect(recording).toContain('displayedMaxDepthMeters');
    expect(recording).toContain('ceil(max(currentDepthMeters, displayedMaxDepthMeters) / 10) * 10');
    expect(recording).toContain('DepthGaugeRail');
    expect(watchUiCheck).toContain('ios/DiveWatchApp/Views/DepthGaugeRail.swift');
  });

  it('keeps watch recording state in mode-specific engines', () => {
    const recorder = readRepoFile('apps/mobile/ios/DiveWatchApp/Recording/DiveSessionRecorder.swift');

    expect(recorder).toContain('FreeDiveSessionEngine');
    expect(recorder).toContain('ScubaDiveEngine');
    expect(recorder).toContain('DiveSessionRecord');
    expect(recorder).not.toContain('private func updateSafetyStop');
  });

  it('uses app-store style stars for post-dive rating fields', () => {
    const summary = readRepoFile('apps/mobile/ios/DiveWatchApp/Views/SummaryView.swift');

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
