//
//  AmbitBleModule.swift — iOS/iPadOS BLE for Sommet. Ambit3 / Traverse / Kailash.
//
//  ARCHITECTURE (ported from android/.../ble/AmbitBleModule.kt, which was proven
//  on real hardware over days of iteration — 2026-08-29): the Ambit3 BLE protocol
//  is INVERTED, ANCS-style. The custom NSP service is NOT hosted on the watch —
//  the watch only exposes generic GATT services and advertises the NSP service
//  UUID as a *solicitation* ("connect to me if you host NSP"). The PHONE hosts a
//  GATT server with the NSP service; it scans for the soliciting watch, connects
//  out to it (link-layer central), and the watch — as GATT client — discovers the
//  phone's NSP service and reads/writes it.
//
//  On iOS this needs BOTH managers together:
//    • CBCentralManager  — scan for the watch (matching the NSP solicitation or a
//      family name), then connect out to it. (Mirrors Kotlin's scan +
//      gattServer.connect.)
//    • CBPeripheralManager — host the NSP GATT server. iOS exposes this local
//      server to the connected watch, so the watch can discover it and subscribe.
//
//  NSP server spec (byte-for-byte from the Android module / decompiled Suunto app):
//    service 98ae7120  PRIMARY
//      notify d0fd6b80  .notify  — phone -> watch (we updateValue on it)
//      write  c6339440  .writeWithoutResponse — watch -> phone (didReceiveWrite)
//    (UUID names are from the WATCH's point of view: NSP_TO_CLIENT = d0fd6b80,
//     NSP_TO_SERVER = c6339440. We are the server, so those roles invert.)
//
//  The NSP framing/CRC/handshake in protocol_ble.c is UNCHANGED — only the GATT
//  plumbing direction. protocol_ble.c calls our write callback to "send to the
//  watch" (→ updateValue on notify) and we call ambit_ios_ble_on_notify() to feed
//  "received from the watch" (← writes on the write char). Registers as
//  NativeModules.AmbitBleModule; JS surface identical to the Kotlin module.
//

import Foundation
import CoreBluetooth
import React
import os

// Trace to the unified log (subsystem com.sommet.ble). Capture on the Mac with:
//   log stream --predicate 'subsystem == "com.sommet.ble"' --level debug
private let bleLog = OSLog(subsystem: "com.sommet.ble", category: "nsp")
private func BLE_LOG(_ msg: String) {
  os_log("%{public}@", log: bleLog, type: .default, msg)
  // Also to stderr so it's visible via `devicectl device process launch --console`.
  FileHandle.standardError.write(Data(("[sommet.ble] " + msg + "\n").utf8))
}

private let kNspServiceUUID   = CBUUID(string: "98ae7120-e62e-11e3-badd-0002a5d5c51b")
// c6339440 = NSP_TO_SERVER: the WATCH writes into this; WE (the server) receive it.
private let kNspWriteCharUUID  = CBUUID(string: "c6339440-e62e-11e3-a5b3-0002a5d5c51b")
// d0fd6b80 = NSP_TO_CLIENT: WE (the server) notify the watch on this.
private let kNspNotifyCharUUID = CBUUID(string: "d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b")

private let kSuuntoVID: UInt16 = 0x1493
private let kCompatibleNamePrefixes = ["Ambit3", "Traverse", "Suunto NSP", "Suunto Kailash", "Kailash"]
private let kScanTimeoutSec: TimeInterval = 20.0
private let knownWatchesKey = "Sommet.knownBluetoothWatches"

// VID is always Suunto's; PID only picks the driver_support row (mirrors Kotlin guessProductId).
// Only a first guess: libambit_ios.c takes the real id from the model the watch names in its
// hello. The advertised prefixes are Movescount's own table (a Traverse Alpha is "TraverseA ").
private func guessProductId(_ name: String?) -> UInt16 {
  guard let n = name else { return 0x001c }
  if n.hasPrefix("TraverseA ") || n.hasPrefix("Traverse Alpha") { return 0x002d }
  if n.hasPrefix("Traverse") { return 0x002b }
  if n.hasPrefix("Ambit3V ") { return 0x002c }
  if n.hasPrefix("Ambit3R ") { return 0x001e }
  if n.hasPrefix("Ambit3S ") { return 0x001c }
  if n.hasPrefix("Ambit3 ") { return 0x001b }
  return 0x001c
}

// C write thunk: protocol_ble.c calls this (@convention(c), no Swift context) with
// each outgoing GATT chunk. `ud` is the module instance passed as opaque userdata.
private func ambitBleWriteThunk(_ ud: UnsafeMutableRawPointer?,
                                _ data: UnsafePointer<UInt8>?,
                                _ len: Int) {
  guard let ud = ud, let data = data, len > 0 else { return }
  let module = Unmanaged<AmbitBleModule>.fromOpaque(ud).takeUnretainedValue()
  module.enqueueOutgoing(Data(bytes: data, count: len))
}

@objc(AmbitBleModule)
final class AmbitBleModule: RCTEventEmitter {

  // CoreBluetooth delegate queue. CRITICAL: not main, and different from the queue
  // the blocking handshake runs on (the handshake waits for the watch's frames,
  // which arrive as GATT writes on THIS queue). Mirrors Android's binder-vs-executor.
  private let bleQueue = DispatchQueue(label: "com.sommet.ble")

  private var central: CBCentralManager!
  private var peripheralMgr: CBPeripheralManager!

  private var watch: CBPeripheral?                 // the watch (link-layer peripheral we connect to)
  private var notifyChar: CBMutableCharacteristic! // d0fd6b80, we notify on it
  private var subscribedCentral: CBCentral?        // the watch as it accesses our server (GATT client)
  private var device: OpaquePointer?               // ambit_object_t*

  private var connectResolve: RCTPromiseResolveBlock?
  private var connectReject: RCTPromiseRejectBlock?
  private var pinnedAddress: String?
  private var reconnectAddress: String?
  private var linkGeneration = 0
  private var scanning = false
  private var handshakeInFlight = false
  private var serviceAdded = false
  private var hasListeners = false

  // CoreBluetooth reports queue capacity, with no callback per delivered notification.
  // Pace NSP fragments as the desktop BLE server does for long route writes.
  private var outQueue = [Data]()
  private var outBlocked = false
  private var outPacing = false

  // MARK: RCTEventEmitter
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! {
    ["AmbitBleDisconnected", "AmbitBleReconnected", "AmbitBleSyncRequested"]
  }
  override func startObserving() { bleQueue.async { self.hasListeners = true } }
  override func stopObserving() { bleQueue.async { self.hasListeners = false } }

  override init() {
    super.init()
    // Bring up both managers up front; hosting the NSP server as early as possible
    // means it's ready the moment the watch connects and looks for it.
    central = CBCentralManager(delegate: self, queue: bleQueue)
    peripheralMgr = CBPeripheralManager(delegate: self, queue: bleQueue)
  }

  // MARK: Exported methods (match AmbitBleModule.ts)

  @objc(scanAndConnect:rejecter:)
  func scanAndConnect(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    beginScan(address: nil, resolve: resolve, reject: reject)
  }

  @objc(scanAndConnectTo:resolver:rejecter:)
  func scanAndConnectTo(_ address: String,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    beginScan(address: address, resolve: resolve, reject: reject)
  }

  // Keep watches Sommet has connected to. CoreBluetooth doesn't expose the OS bond list.
  @objc(listBondedWatches:rejecter:)
  func listBondedWatches(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    bleQueue.async {
      let watches = UserDefaults.standard.dictionary(forKey: knownWatchesKey) ?? [:]
      resolve(watches.compactMap { address, name in
        (name as? String).map { ["address": address, "name": $0] }
      }.sorted { $0["address", default: ""] < $1["address", default: ""] })
    }
  }

  @objc(armAutoReconnect:resolver:rejecter:)
  func armAutoReconnect(_ address: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    bleQueue.async {
      guard let id = UUID(uuidString: address) else { resolve(false); return }
      self.reconnectAddress = id.uuidString
      self.resumeReconnect()
      resolve(true)
    }
  }

  @objc(forgetBondedWatch:resolver:rejecter:)
  func forgetBondedWatch(_ address: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    bleQueue.async {
      var watches = UserDefaults.standard.dictionary(forKey: knownWatchesKey) ?? [:]
      watches.removeValue(forKey: address)
      UserDefaults.standard.set(watches, forKey: knownWatchesKey)
      let currentAddress = self.watch?.identifier.uuidString ?? self.subscribedCentral?.identifier.uuidString
      if self.reconnectAddress == address || currentAddress == address {
        self.reconnectAddress = nil
        self.failConnect("DISCONNECTED", "Bluetooth connection cancelled")
        self.teardown(emitStatus: nil)
      }
      resolve(true)
    }
  }

  @objc(disconnectBle:rejecter:)
  func disconnectBle(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    bleQueue.async {
      self.reconnectAddress = nil
      self.failConnect("DISCONNECTED", "Bluetooth connection cancelled")
      self.teardown(emitStatus: nil)
      resolve(true)
    }
  }

  // MARK: Scan / connect

  private func beginScan(address: String?,
                         resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
    bleQueue.async {
      if self.connectResolve != nil || self.handshakeInFlight {
        reject("BUSY", "A BLE connect is already in progress", nil); return
      }
      // Because we advertise continuously, the watch may have connected + finished
      // the NSP handshake on its own before the user tapped Pair. If we already have
      // a live device, tell JS it's connected right now (this is the signal the JS
      // layer needs to enable sync) instead of starting a fresh scan that would time
      // out (the watch is already subscribed and won't re-subscribe).
      if self.device != nil {
        let addr = self.watch?.identifier.uuidString ?? self.subscribedCentral?.identifier.uuidString
        if let addr = addr, address == nil || address == addr {
          resolve(addr)
          return
        }
      }
      self.reconnectAddress = nil
      self.teardown(emitStatus: nil)
      self.connectResolve = resolve
      self.connectReject = reject
      self.pinnedAddress = address
      let generation = self.linkGeneration

      // Arm the pre-init RX stash BEFORE the watch can write.
      ambit_ios_ble_reset_rx_stash()
      self.ensureServiceAdded()

      if self.central.state == .poweredOn {
        self.startScan()
      } else if self.central.state != .unknown && self.central.state != .resetting {
        self.failConnect("BLE_UNAVAILABLE", "Bluetooth is off or unavailable")
      } // else: centralManagerDidUpdateState will start the scan

      self.bleQueue.asyncAfter(deadline: .now() + kScanTimeoutSec) {
        if self.linkGeneration == generation && self.connectResolve != nil && !self.handshakeInFlight {
          self.failConnect("SCAN_TIMEOUT",
            "No Ambit3/Traverse/Kailash found — trigger \u{201C}Sync now\u{201D} / \u{201C}Pair Mobile App\u{201D} on the watch right before scanning; its advertising window is short.")
          self.teardown(emitStatus: nil)
        }
      }
    }
  }

  private func startScan() {
    guard !scanning else { return }
    scanning = true
    // Scan unfiltered and match in didDiscover — the watch advertises the NSP UUID
    // as a *solicitation* (CBAdvertisementDataSolicitedServiceUUIDsKey), which a
    // service-UUID scan filter does not match (same nuance the Kotlin module hit).
    central.scanForPeripherals(withServices: nil,
                               options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
  }

  private func stopScan() {
    if scanning { central.stopScan(); scanning = false }
  }

  private func resumeReconnect() {
    guard let address = reconnectAddress, device == nil, watch == nil,
          connectResolve == nil, !handshakeInFlight, central.state == .poweredOn else { return }
    pinnedAddress = address
    ambit_ios_ble_reset_rx_stash()
    ensureServiceAdded()
    startScan()
  }

  private func failConnect(_ code: String, _ message: String) {
    BLE_LOG("failConnect(\(code)): \(message)")
    let reject = connectReject
    connectResolve = nil
    connectReject = nil
    stopScan()
    reject?(code, message, nil)
  }

  // MARK: GATT server (CBPeripheralManager) — host the NSP service

  private func ensureServiceAdded() {
    guard peripheralMgr.state == .poweredOn, !serviceAdded else { return }
    let service = CBMutableService(type: kNspServiceUUID, primary: true)
    // notify char: iOS manages the CCCD automatically for a .notify characteristic;
    // value must be nil for a dynamic (notify/write) characteristic.
    // ENCRYPTION REQUIRED (2026-08-30, from the working Suunto-app sniff, Downloads/*.pklg
    // decoded via tools/ble_pklg.py + tshark): in the real capture the watch's first
    // write/subscribe to these characteristics is rejected "insufficient encryption", which
    // triggers a full SMP LE-Secure-Connections pairing/bond — and ONLY AFTER the bond does the
    // watch run NSP (its 0x1201 opener, hello, …). With plain .readable/.writeable the watch
    // subscribes with no reject, no pairing is triggered, no bond forms, and the Ambit3 firmware
    // refuses to run NSP over the unsecured link — it subscribes then goes silent (0 frames),
    // exactly the failure we traced. Requiring encryption forces the same bond the Suunto app
    // gets. (MTU is 20 in that working capture too, so it was never the MTU.)
    notifyChar = CBMutableCharacteristic(type: kNspNotifyCharUUID,
                                         properties: [.notifyEncryptionRequired],
                                         value: nil,
                                         permissions: [.readEncryptionRequired])
    let writeChar = CBMutableCharacteristic(type: kNspWriteCharUUID,
                                            properties: [.writeWithoutResponse, .write],
                                            value: nil,
                                            permissions: [.writeEncryptionRequired])
    service.characteristics = [notifyChar, writeChar]
    peripheralMgr.add(service)
    serviceAdded = true
  }

  // MARK: Outgoing (phone -> watch): notify on d0fd6b80, chunked with backpressure

  func enqueueOutgoing(_ data: Data) {
    bleQueue.async {
      guard self.subscribedCentral != nil else { return }
      self.outQueue.append(data)
      self.drainOutgoing()
    }
  }

  private func drainOutgoing() {
    guard !outBlocked, !outPacing, let central = subscribedCentral, let chunk = outQueue.first else { return }
    guard peripheralMgr.updateValue(chunk, for: notifyChar, onSubscribedCentrals: [central]) else {
      // Keep this fragment queued until peripheralManagerIsReady resumes.
      outBlocked = true
      return
    }
    outQueue.removeFirst()
    outPacing = true
    let generation = linkGeneration
    bleQueue.asyncAfter(deadline: .now() + .milliseconds(15)) { [weak self] in
      guard let self, self.linkGeneration == generation else { return }
      self.outPacing = false
      self.drainOutgoing()
    }
  }

  // MARK: Handshake

  private func startHandshake(for central: CBCentral) {
    guard device == nil, !handshakeInFlight else { return }
    guard connectResolve != nil || reconnectAddress != nil else { return }
    if watch == nil, let pin = pinnedAddress, central.identifier.uuidString != pin { return }
    handshakeInFlight = true
    subscribedCentral = central
    stopScan()

    let selfPtr = Unmanaged.passUnretained(self).toOpaque()
    let vid = kSuuntoVID
    let pid = guessProductId(watch?.name)
    let addr = watch?.identifier.uuidString ?? central.identifier.uuidString
    let name = watch?.name ?? "Suunto watch"
    let generation = linkGeneration
    // Run the BLOCKING handshake off bleQueue (writes arrive on bleQueue).
    ambit_ios_device_queue().async {
      let obj = libambit_new_from_ble_ios(ambitBleWriteThunk, selfPtr, vid, pid)
      BLE_LOG("handshake result: \(obj != nil ? "OK" : "FAILED")")
      self.bleQueue.async {
        self.handshakeInFlight = false
        guard self.linkGeneration == generation else {
          if let obj = obj { ambit_ios_device_queue().async { libambit_close(obj) } }
          self.resumeReconnect()
          return
        }
        if let obj = obj {
          self.device = obj
          var watches = UserDefaults.standard.dictionary(forKey: knownWatchesKey) ?? [:]
          if watches[addr] == nil || name != "Suunto watch" { watches[addr] = name }
          UserDefaults.standard.set(watches, forKey: knownWatchesKey)
          let resolve = self.connectResolve
          self.connectResolve = nil
          self.connectReject = nil
          if let resolve = resolve { resolve(addr) }
          else if self.hasListeners { self.sendEvent(withName: "AmbitBleReconnected", body: ["address": addr]) }
        } else {
          self.failConnect("BLE_INIT_FAILED",
            "Watch connected and subscribed, but the NSP device-info handshake failed.")
          self.teardown(emitStatus: nil)
          self.resumeReconnect()
        }
      }
    }
  }

  // MARK: Teardown

  private func teardown(emitStatus status: Int?) {
    linkGeneration += 1
    stopScan()
    if let w = watch { central.cancelPeripheralConnection(w) }
    ambit_ios_ble_disconnected()
    if let d = device {
      device = nil
      ambit_ios_device_queue().async { libambit_close(d) }
    }
    watch = nil
    subscribedCentral = nil
    outQueue.removeAll()
    outBlocked = false
    outPacing = false
    if let s = status, hasListeners {
      sendEvent(withName: "AmbitBleDisconnected", body: ["status": s])
    }
  }
}

// MARK: - CBCentralManagerDelegate (scan + connect to the watch)

extension AmbitBleModule: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      if connectResolve != nil, watch == nil { startScan() }
      else { resumeReconnect() }
    case .poweredOff, .resetting, .unauthorized, .unsupported:
      let connected = device != nil
      failConnect("BLE_UNAVAILABLE", "Bluetooth is off or unavailable")
      teardown(emitStatus: connected ? central.state.rawValue : nil)
    default:
      break
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard scanning, watch == nil, !handshakeInFlight else { return }
    if let pin = pinnedAddress, peripheral.identifier.uuidString != pin { return }

    let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
    let solicited = advertisementData[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID] ?? []
    let advertised = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
    let solicitsNsp = solicited.contains(kNspServiceUUID) || advertised.contains(kNspServiceUUID)
    let nameMatches = name.map { n in kCompatibleNamePrefixes.contains { n.hasPrefix($0) } } ?? false
    guard solicitsNsp || nameMatches else { return }

    BLE_LOG("scan match: name=\(name ?? "?") solicitsNsp=\(solicitsNsp) addr=\(peripheral.identifier.uuidString) — connecting")
    stopScan()
    watch = peripheral
    // Connect out to the watch (link-layer central). We do NOT discover the watch's
    // services — the NSP service lives on OUR side (peripheralMgr); the watch will
    // discover and subscribe to it once the link is up.
    central.connect(peripheral, options: nil)
    if connectResolve == nil {
      let generation = linkGeneration
      bleQueue.asyncAfter(deadline: .now() + kScanTimeoutSec) {
        guard self.linkGeneration == generation, self.device == nil, !self.handshakeInFlight else { return }
        self.teardown(emitStatus: nil)
        self.resumeReconnect()
      }
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    BLE_LOG("central didConnect \(peripheral.identifier.uuidString) — waiting for watch to subscribe to our NSP notify CCCD")
    // Link is up. Now we wait for the watch (GATT client) to discover our NSP
    // service and subscribe to the notify CCCD — handled in peripheralManager
    // didSubscribeTo. Nothing to do on the central side.
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard watch?.identifier == peripheral.identifier else { return }
    failConnect("CONNECT_FAILED", error?.localizedDescription ?? "Failed to connect to the watch")
    teardown(emitStatus: nil)
    resumeReconnect()
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard watch?.identifier == peripheral.identifier else { return }
    let connected = device != nil
    failConnect("DISCONNECTED", error?.localizedDescription ?? "Watch disconnected during connection")
    teardown(emitStatus: connected ? ((error as NSError?)?.code ?? 0) : nil)
    resumeReconnect()
  }
}

// MARK: - CBPeripheralManagerDelegate (host NSP server; watch is the GATT client)

extension AmbitBleModule: CBPeripheralManagerDelegate {
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn { ensureServiceAdded() }
    else { serviceAdded = false }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    BLE_LOG("NSP service added (err=\(error?.localizedDescription ?? "nil")) — start advertising")
    if let error = error {
      serviceAdded = false
      failConnect("GATT_FAILED", error.localizedDescription)
      teardown(emitStatus: nil)
      return
    }
    // Advertise the NSP service so the watch (which, like ANCS, connects to the
    // iPhone as a CENTRAL) can discover our server and connect to us. This is the
    // path the official app uses alongside the outbound scan.
    if !peripheral.isAdvertising {
      peripheral.startAdvertising([
        CBAdvertisementDataServiceUUIDsKey: [kNspServiceUUID],
        CBAdvertisementDataLocalNameKey: "Sommet",
      ])
    }
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    BLE_LOG("advertising started (err=\(error?.localizedDescription ?? "nil"))")
  }

  // The watch subscribing to our notify characteristic's CCCD is the "transport
  // live" signal (Android: onDescriptorWriteRequest / serviceReady). Start the
  // native device-info handshake here, exactly once.
  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                         didSubscribeTo characteristic: CBCharacteristic) {
    BLE_LOG("didSubscribeTo char=\(characteristic.uuid) central=\(central.identifier.uuidString) mtu=\(central.maximumUpdateValueLength)")
    guard characteristic.uuid == kNspNotifyCharUUID else { return }
    BLE_LOG("watch SUBSCRIBED to NSP notify (mtu=\(central.maximumUpdateValueLength)) — starting handshake")
    startHandshake(for: central)
  }

  // Log any read the watch makes against our server (service/characteristic discovery reads).
  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    BLE_LOG("didReceiveRead char=\(request.characteristic.uuid) offset=\(request.offset)")
    peripheral.respond(to: request, withResult: .success)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                         didUnsubscribeFrom characteristic: CBCharacteristic) {
    guard characteristic.uuid == kNspNotifyCharUUID,
          subscribedCentral?.identifier == central.identifier else { return }
    let connected = device != nil
    failConnect("DISCONNECTED", "Watch stopped listening during connection")
    teardown(emitStatus: connected ? 0 : nil)
    resumeReconnect()
  }

  // Watch -> phone NSP data: writes to c6339440. Feed each into the framing layer.
  func peripheralManager(_ peripheral: CBPeripheralManager,
                         didReceiveWrite requests: [CBATTRequest]) {
    var syncRequested = false
    for req in requests where req.characteristic.uuid == kNspWriteCharUUID && req.central.identifier == subscribedCentral?.identifier {
      if let value = req.value, !value.isEmpty {
        value.withUnsafeBytes { raw in
          if let base = raw.bindMemory(to: UInt8.self).baseAddress {
            if ambit_ios_ble_on_notify(base, value.count) != 0 { syncRequested = true }
          }
        }
      }
    }
    // Respond to the first request (covers .write; harmless for .writeWithoutResponse).
    if let first = requests.first {
      peripheral.respond(to: first, withResult: .success)
    }
    if syncRequested && device != nil && hasListeners {
      sendEvent(withName: "AmbitBleSyncRequested", body: [:])
    }
  }

  // Transmit queue drained — resume sending queued outgoing chunks.
  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    bleQueue.async {
      self.outBlocked = false
      self.drainOutgoing()
    }
  }
}
