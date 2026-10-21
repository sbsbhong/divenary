import { NativeModules, Platform } from 'react-native';
import {defaultWatchLink} from '../companion/default-watch-link';
import type { WatchDepthSample } from '../types/dive-session';
import type { PersistentKeyValueStore } from './persistent-key-value-store';

export type WatchProfileStorage = {
  write(key: string, samples: WatchDepthSample[]): Promise<void>;
  read(key: string): Promise<WatchDepthSample[] | undefined>;
  remove(key: string): Promise<void>;
  writeRaw?(key: string, payloadJson: string): Promise<void>;
  readRaw?(key: string): Promise<string | undefined>;
  copyRaw?(sourceKey: string, destinationKey: string): Promise<void>;
  adoptPrepared?(payloadId: string, destinationKey: string): Promise<void>;
};

export type RawWatchProfileStorage = WatchProfileStorage & {
  writeRaw(key: string, payloadJson: string): Promise<void>;
  readRaw(key: string): Promise<string | undefined>;
  copyRaw(sourceKey: string, destinationKey: string): Promise<void>;
};

type NativeWatchProfileStorageModule = {
  writeProfile(key: string, payloadJson: string): Promise<string>;
  readProfile(key: string): Promise<string>;
  deleteProfile(key: string): Promise<void>;
  writeRawProfile?(key: string, payloadJson: string): Promise<string>;
  readRawProfile?(key: string): Promise<string>;
  copyRawProfile?(sourceKey: string, destinationKey: string): Promise<string>;
};

const nativeModule = Platform.OS === 'ios'
  ? (NativeModules.WatchProfileStorageModule as NativeWatchProfileStorageModule | undefined)
  : undefined;

export function createWatchProfileStorage(
  fallback: PersistentKeyValueStore,
): RawWatchProfileStorage {
  if (nativeModule?.writeProfile && nativeModule.readProfile && nativeModule.deleteProfile) {
    const writeRaw = async (key: string, payloadJson: string) => {
      parseRawProfileSamples(payloadJson);
      if (nativeModule.writeRawProfile !== undefined) {
        await nativeModule.writeRawProfile(key, payloadJson);
      } else {
        await nativeModule.writeProfile(key, payloadJson);
      }
    };
    const readRaw = async (key: string) => {
      try {
        return nativeModule.readRawProfile !== undefined
          ? await nativeModule.readRawProfile(key)
          : await nativeModule.readProfile(key);
      } catch {
        return undefined;
      }
    };
    return {
      async write(key, samples) {
        await writeRaw(key, JSON.stringify(samples));
      },
      async read(key) {
        const stored = await readRaw(key);
        return stored === undefined ? undefined : parseRawProfileSamples(stored);
      },
      async remove(key) {
        await nativeModule.deleteProfile(key);
      },
      writeRaw,
      readRaw,
      async copyRaw(sourceKey, destinationKey) {
        if (nativeModule.copyRawProfile !== undefined) {
          await nativeModule.copyRawProfile(sourceKey, destinationKey);
          return;
        }
        const stored = await readRaw(sourceKey);
        if (stored === undefined) {
          throw new Error(`Missing watch profile ${sourceKey}`);
        }
        await writeRaw(destinationKey, stored);
      },
      async adoptPrepared(payloadId, destinationKey) {
        await defaultWatchLink.adoptPreparedProfile(
          payloadId,
          destinationKey,
        );
      },
    };
  }

  const writeRaw = async (key: string, payloadJson: string) => {
    parseRawProfileSamples(payloadJson);
    await fallback.setString(key, payloadJson);
  };
  const readRaw = (key: string) => fallback.getString(key);
  return {
    async write(key, samples) {
      await writeRaw(key, JSON.stringify(samples));
    },
    async read(key) {
      const stored = await readRaw(key);
      return stored === undefined ? undefined : parseRawProfileSamples(stored);
    },
    async remove(key) {
      await fallback.remove(key);
    },
    writeRaw,
    readRaw,
    async copyRaw(sourceKey, destinationKey) {
      const stored = await readRaw(sourceKey);
      if (stored === undefined) {
        throw new Error(`Missing watch profile ${sourceKey}`);
      }
      await writeRaw(destinationKey, stored);
    },
  };
}

export async function writeWatchProfileRaw(
  storage: WatchProfileStorage,
  key: string,
  payloadJson: string,
): Promise<void> {
  if (storage.writeRaw !== undefined) {
    await storage.writeRaw(key, payloadJson);
    return;
  }
  await storage.write(key, parseRawProfileSamples(payloadJson));
}

export async function readWatchProfileRaw(
  storage: WatchProfileStorage,
  key: string,
): Promise<string | undefined> {
  if (storage.readRaw !== undefined) {
    return storage.readRaw(key);
  }
  const samples = await storage.read(key);
  return samples === undefined ? undefined : JSON.stringify(samples);
}

export async function copyWatchProfileRaw(
  storage: WatchProfileStorage,
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  if (storage.copyRaw !== undefined) {
    await storage.copyRaw(sourceKey, destinationKey);
    return;
  }
  const stored = await readWatchProfileRaw(storage, sourceKey);
  if (stored === undefined) {
    throw new Error(`Missing watch profile ${sourceKey}`);
  }
  await writeWatchProfileRaw(storage, destinationKey, stored);
}

function parseRawProfileSamples(payloadJson: string): WatchDepthSample[] {
  const parsed = JSON.parse(payloadJson) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Malformed watch profile JSON');
  }
  return parsed as WatchDepthSample[];
}
