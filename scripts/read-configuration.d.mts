export interface CastleConfiguration {
  readonly schemaVersion: number;
  readonly applicationName: string;
  readonly applicationBundleId: string;
  readonly libraryPath: string;
  readonly repositoryPath: string;
  readonly ownerNoteId: string;
  readonly ownerDisplayName: string;
  readonly ownerAvatarUrl: string;
}

export function readCastleConfiguration(options?: {
  castleRoot?: string;
}): CastleConfiguration;
