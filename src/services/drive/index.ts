import { useMocks } from '../config';
import { createGoogleDriveService } from './googleDrive';
import { createMockDriveService } from './mockDrive';
import { DriveService } from './types';

export * from './types';

let singleton: DriveService | null = null;

export function getDriveService(): DriveService {
  if (!singleton) {
    singleton = useMocks() ? createMockDriveService() : createGoogleDriveService();
  }
  return singleton;
}

export function resetDriveService(): void {
  singleton = null;
}
