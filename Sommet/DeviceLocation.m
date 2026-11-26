#import <CoreLocation/CoreLocation.h>
#import <React/RCTBridgeModule.h>

@interface DeviceLocation : NSObject <RCTBridgeModule, CLLocationManagerDelegate>
@end

@implementation DeviceLocation {
  CLLocationManager *_manager;
  NSMutableArray<RCTPromiseResolveBlock> *_requests;
  double _timeoutMs;
  BOOL _updating;
}

RCT_EXPORT_MODULE(DeviceLocation);

+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_EXPORT_METHOD(current:(double)timeoutMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_manager) {
      [self->_requests addObject:resolve];
      return;
    }

    self->_requests = [NSMutableArray arrayWithObject:resolve];
    self->_timeoutMs = timeoutMs;
    self->_manager = [CLLocationManager new];
    self->_manager.desiredAccuracy = kCLLocationAccuracyBest;
    self->_manager.delegate = self;
    if (self->_manager.authorizationStatus == kCLAuthorizationStatusNotDetermined) {
      [self->_manager requestWhenInUseAuthorization];
    } else {
      [self locationManagerDidChangeAuthorization:self->_manager];
    }
  });
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager
{
  if (manager != _manager) return;
  switch (manager.authorizationStatus) {
    case kCLAuthorizationStatusAuthorizedAlways:
    case kCLAuthorizationStatusAuthorizedWhenInUse: {
      if (_updating) return;
      _updating = YES;
      [manager startUpdatingLocation];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(_timeoutMs * NSEC_PER_MSEC)),
                     dispatch_get_main_queue(), ^{
        if (self->_manager == manager) [self finishWithLocation:nil];
      });
      break;
    }
    case kCLAuthorizationStatusRestricted:
    case kCLAuthorizationStatusDenied:
      [self finishWithLocation:nil];
      break;
    case kCLAuthorizationStatusNotDetermined:
      break;
  }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations
{
  if (manager != _manager) return;
  CLLocation *location = locations.lastObject;
  if (location && location.horizontalAccuracy >= 0 && CLLocationCoordinate2DIsValid(location.coordinate)
      && [location.timestamp timeIntervalSinceNow] >= -30) {
    [self finishWithLocation:location];
  }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error
{
  if (manager == _manager && error.code != kCLErrorLocationUnknown) [self finishWithLocation:nil];
}

- (void)finishWithLocation:(CLLocation *)location
{
  [_manager stopUpdatingLocation];
  _manager.delegate = nil;
  _manager = nil;
  _updating = NO;
  NSArray<RCTPromiseResolveBlock> *requests = _requests;
  _requests = nil;
  id place = location ? @{
    @"lat": @(location.coordinate.latitude),
    @"lon": @(location.coordinate.longitude),
    @"accuracy": @(location.horizontalAccuracy),
    @"ageSeconds": @(MAX(0, -[location.timestamp timeIntervalSinceNow])),
  } : (id)kCFNull;
  for (RCTPromiseResolveBlock resolve in requests) resolve(place);
}

@end
