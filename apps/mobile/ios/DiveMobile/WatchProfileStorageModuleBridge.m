#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WatchProfileStorageModule, NSObject)

RCT_EXTERN_METHOD(writeProfile:(NSString *)key
                  payloadJson:(NSString *)payloadJson
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(readProfile:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteProfile:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
