import type { GeolocationResponse } from '@react-native-community/geolocation';
import { createLocationService } from '../src/conditions/location-service';

function makeGeolocationPosition(latitude: number, longitude: number): GeolocationResponse {
  return {
    coords: {
      latitude,
      longitude,
      altitude: null,
      accuracy: 12,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: 1_783_512_000_000,
  };
}

describe('createLocationService', () => {
  it('retries transient POSITION_UNAVAILABLE and returns the next position', async () => {
    const request = jest
      .fn()
      .mockImplementationOnce((_success, failure) =>
        failure({ code: 2, message: 'location unknown' }),
      )
      .mockImplementationOnce(success =>
        success(makeGeolocationPosition(37.1, 127.1)),
      );
    const wait = jest.fn(async () => undefined);
    const service = createLocationService({
      getCurrentPosition: request,
      wait,
    });

    await expect(service.getCurrentLocation()).resolves.toEqual({
      status: 'granted',
      coordinates: {
        latitude: 37.1,
        longitude: 127.1,
        horizontalAccuracyMeters: 12,
        capturedAt: 1_783_512_000,
      },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it('stops after three transient attempts', async () => {
    const request = jest.fn((_success, failure) =>
      failure({ code: 2, message: 'location unknown' }),
    );
    const wait = jest.fn(async () => undefined);
    const service = createLocationService({
      getCurrentPosition: request,
      wait,
    });

    await expect(service.getCurrentLocation()).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 250);
    expect(wait).toHaveBeenNthCalledWith(2, 750);
  });

  it('does not retry permission denial', async () => {
    const request = jest.fn((_success, failure) =>
      failure({ code: 1, message: 'denied' }),
    );
    const service = createLocationService({
      getCurrentPosition: request,
      wait: async () => undefined,
    });

    await expect(service.getCurrentLocation()).resolves.toEqual({
      status: 'permissionDenied',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
