#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ReverseGeocoderModule, NSObject)

RCT_EXTERN_METHOD(reverseGeocode:(nonnull NSNumber *)latitude
                  longitude:(nonnull NSNumber *)longitude
                  locale:(nullable NSString *)locale
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
