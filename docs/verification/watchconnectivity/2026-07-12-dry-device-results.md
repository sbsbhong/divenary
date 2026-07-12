# WatchConnectivity Dry-Device Results - 2026-07-12

- Branch: `feature/pre-dive-readiness`
- Build identifier: DiveMobile 1.0 (1), bundle `org.reactjs.native.example.DiveMobile`
- iPhone / iOS: iPhone 14 Pro (iPhone15,2), iOS 26.5 (23F77)
- iPhone CoreDevice: paired, booted, developer mode enabled, local-network tunnel connected
- Apple Watch / watchOS: Watch7,12, watchOS version unavailable while CoreDevice tunnel is disconnected
- Apple Watch CoreDevice: paired, local-network tunnel disconnected
- Pairing / companion install: iPhone app installed and launched; embedded `Watch/DiveWatchApp.app` confirmed in build product; Watch-side installation NOT RUN
- Baseline automated checks:
  - `yarn mobile:typecheck`: PASS
  - WatchConnectivity Jest suites: PASS, 44 tests
  - `yarn watch:build`: PASS outside sandbox; sandboxed preview macro execution is blocked

| Case | Connection and app state | Payload evidence | Result | Crash/log |
|---|---|---|---|---|
| Connected Test Scuba auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Connected Test Freedive auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Offline save then reconnect auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Reconnect auto import plus manual drain | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Manual retry after delayed auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Duplicate delivery dedupe | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iPhone background delivery | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iPhone killed then launch drain | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Planned dive round trip | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Watch acknowledgement status | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Large payload file transfer | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Connected Demo auto import | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

## Baseline environment notes

- Initial CocoaPods install failed because the login shell mixed Homebrew Ruby 3.4 with RVM Bundler 2.1.4.
- Running Bundler explicitly with RVM Ruby 2.7 removed the mixed-runtime failure but the RVM gemset lacked `CFPropertyList 3.0.9`.
- The worktree uses a copy of the main checkout's ignored `Pods` directory after confirming identical `Podfile.lock` files.
- The first signed build generated missing React Native codegen output but compilation started before those files existed. The following incremental build completed the app product from those generated files.
- The signed physical product contains `Watch/DiveWatchApp.app`; iPhone install and CLI launch succeeded.
- Direct Watch CLI launch is blocked because the Watch CoreDevice local-network tunnel times out. Manual Watch launch remains required for the baseline matrix.

## Baseline conclusion

Physical Watch matrix is deferred until implementation and automated verification finish. There is no reconnect crash conclusion yet.

## Post-change regression

Physical matrix: NOT RUN. The Watch app has not been installed on the physical Watch.

Automated post-change gates:

- Watch import coordinator Jest suite: PASS, 15 tests.
- Mobile cloud/Watch status separation suites: PASS, 107 tests with `--forceExit`; `App.test.tsx` has a pre-existing open-handle exit warning even when run alone.
- Mobile TypeScript: PASS.
- Optional-temperature Watch suites: PASS, 30 tests.
- Large fixture Watch persistence/transport suite: PASS, 21 tests.
- Native WatchConnectivity source contract: PASS, 31 tests.
- `yarn watch:build`: PASS.

The next physical run must use the repository checklist. No paired Watch delivery, reconnect, background/killed delivery, large file transfer, or shallow-water sensor result is claimed yet.
