import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    WatchConnectivityInbox.shared.activate()

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Divenary",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  private static let splashBackgroundColor = UIColor { traitCollection in
    if traitCollection.userInterfaceStyle == .dark {
      return .black
    }

    return UIColor(
      red: 245.0 / 255.0,
      green: 245.0 / 255.0,
      blue: 247.0 / 255.0,
      alpha: 1
    )
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  override func customize(_ rootView: RCTRootView) {
    let splashBackgroundColor = Self.splashBackgroundColor
    rootView.backgroundColor = splashBackgroundColor

    let loadingView = UIView(frame: rootView.bounds)
    loadingView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    loadingView.backgroundColor = splashBackgroundColor
    loadingView.isUserInteractionEnabled = false

    let markView = UIImageView(image: UIImage(named: "SplashMark"))
    markView.translatesAutoresizingMaskIntoConstraints = false
    markView.contentMode = .scaleAspectFit
    markView.isUserInteractionEnabled = false
    loadingView.addSubview(markView)

    NSLayoutConstraint.activate([
      markView.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
      markView.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor),
      markView.widthAnchor.constraint(equalToConstant: 96),
      markView.heightAnchor.constraint(equalToConstant: 96),
    ])

    rootView.loadingViewFadeDelay = 0
    rootView.loadingViewFadeDuration = 0.2
    rootView.loadingView = loadingView
  }
}
