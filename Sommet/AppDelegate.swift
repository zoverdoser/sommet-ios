import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var reactNativeDelegate: ReactNativeDelegate?
  private var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    for context in connectionOptions.urlContexts {
      SommetReceiveGpxURL(context.url)
    }
    factory.startReactNative(withModuleName: "Sommet", in: window)
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      SommetReceiveGpxURL(context.url)
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func customize(_ rootView: RCTRootView) {
    let title = UILabel()
    title.text = "Sommet"
    title.font = .systemFont(ofSize: 32, weight: .bold)
    title.textColor = .label
    title.backgroundColor = .systemBackground
    title.textAlignment = .center
    rootView.loadingView = title
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // The default Metro port can belong to another app on the development Mac.
    if ProcessInfo.processInfo.environment["SOMMET_USE_METRO"] == "1",
       let metroURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index") {
      RCTDevLoadingViewSetEnabled(true)
      return metroURL
    }
    RCTDevLoadingViewSetEnabled(false)
#endif
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }
}
