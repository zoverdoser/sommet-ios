//
//  Sommet-Bridging-Header.h
//  Exposes the libambit C surface (AmbitBridge.h) to Swift so AmbitBleModule
//  can drive the BLE transport. Header search paths include ios/AmbitBle.
//
#import "AmbitBridge.h"
#import <React/RCTDevLoadingViewSetEnabled.h>

#import <Foundation/Foundation.h>
void SommetReceiveGpxURL(NSURL * _Nonnull source);
