export const WALRUSCAN_BLOB_BASE = "https://walruscan.com/mainnet/blob";

export function walruscanBlobUrl(blobId: string): string {
  return `${WALRUSCAN_BLOB_BASE}/${blobId}`;
}
