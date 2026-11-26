# Sommet for iOS

This is a standalone iOS port of [Sommet](https://github.com/skinnie/sommet), based on upstream commit `c9f826b`. The React Native app, Xcode project, and watch protocol sources are all in this directory.

## Build and debug

You need macOS with Xcode, Node.js 22.11 or later, and CocoaPods. From the repository root, set up the local config and dependencies.

```sh
cp -n src/config/secrets.example.ts src/config/secrets.ts
npm ci
pod install
```

1. Open `Sommet.xcworkspace` and select the `Sommet` scheme and your iPhone. Choose your Apple development team in **Signing & Capabilities**. The development bundle identifier is `com.mono.sommet`.
2. Build and run from Xcode. Debug builds use the bundled JavaScript by default. For Metro, run `npm start` and set `SOMMET_USE_METRO=1` in the Xcode scheme's Run environment.
3. On the iPhone, grant Sommet Bluetooth access. On the Traverse Alpha, choose **Pair Mobile App**, then connect from Sommet.
4. Check that Home identifies **Suunto Traverse Alpha** and shows its battery level. Read an activity and export a GPX/FIT file before testing navigation writes. Exports saved without a picker appear in **Files → On My iPhone → Sommet → Downloads**.

The iPhone uses BLE to communicate with the watch. Use Xcode's console for `[sommet.ble]` and `[sommet.core]` messages. BLE reconnect runs while the app is in the foreground. Forgetting a watch in Sommet removes its app registration. Manage system pairing in iOS Bluetooth settings.

## Local configuration

The example Strava OAuth config has empty values. Keep any development credentials in `src/config/secrets.ts` and any machine-specific Xcode settings in `.xcode.env.local`. Local watch sync, GPX/FIT, POIs, and routes work with the blank Strava config.

Git ignores the local config, signing keys and provisioning profiles, runtime databases, activity and route exports, and build products. Commit changes to the example config using empty or sample values.
