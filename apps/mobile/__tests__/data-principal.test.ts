import {
  dataProfileKeyPrefix,
  dataStorageKeys,
  principalScope,
} from '../src/storage/data-principal';

describe('data principal storage identity', () => {
  it('uses the exact guest key contract', () => {
    expect(dataStorageKeys({ kind: 'guest' })).toEqual({
      logbook: 'dive-app:data:guest:logbook:v1',
      planbook: 'dive-app:data:guest:planbook:v1',
      outbox: 'dive-app:data:guest:outbox:v1',
      claim: 'dive-app:data:guest:claim:v1',
    });
    expect(principalScope({ kind: 'guest' })).toBe('guest');
    expect(dataProfileKeyPrefix({ kind: 'guest' })).toBe('dive-mobile:watch-profile:guest:');
  });

  it('encodes the entire user scope so reserved characters cannot collide', () => {
    expect(dataStorageKeys({ kind: 'user', userId: 'user/one' }).logbook)
      .toBe('dive-app:data:user%3Auser%2Fone:logbook:v1');
    expect(dataStorageKeys({ kind: 'user', userId: 'user:one' }).logbook)
      .toBe('dive-app:data:user%3Auser%3Aone:logbook:v1');
    expect(dataStorageKeys({ kind: 'user', userId: 'user%3Aone' }).logbook)
      .toBe('dive-app:data:user%3Auser%253Aone:logbook:v1');
    expect(dataProfileKeyPrefix({ kind: 'user', userId: 'user/one' }))
      .toBe('dive-mobile:watch-profile:user%3Auser%2Fone:');
  });
});
