/**
 * Store logos live in a public Supabase Storage bucket. The API uploads with
 * the service key; the browser only ever sees the public URL.
 *
 * A missing configuration is not fatal: the logo routes answer 503 and the
 * app keeps showing initials. That keeps local dev and tests independent of
 * the storage provider.
 */

const BUCKET = 'store-logos';

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface LogoStore {
  put(storeId: string, bytes: Buffer, contentType: string): Promise<string>;
  remove(storeId: string): Promise<void>;
}

export class LogoStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogoStoreError';
  }
}

const base = (url: string): string => url.trim().replace(/\/+$/, '');

/**
 * The same repair the env loader applies: a pasted URL that lost its leading
 * "h" (`ttps://`) must not silently break uploads while auth keeps working.
 */
const withScheme = (url: string): string =>
  /^ttps?:\/\//i.test(url) ? `h${url}` : url;

export function createLogoStore(
  supabaseUrl: string | undefined,
  secretKey: string | undefined,
): LogoStore | null {
  if (supabaseUrl === undefined || supabaseUrl === '' || secretKey === undefined || secretKey === '') {
    return null;
  }
  const root = base(withScheme(supabaseUrl));
  const headers = {
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
  };

  const objectPath = (storeId: string, extension: string): string =>
    `${storeId}/logo.${extension}`;

  return {
    async put(storeId, bytes, contentType) {
      const extension = EXTENSION[contentType];
      if (extension === undefined) throw new LogoStoreError('Unsupported image type');
      const path = objectPath(storeId, extension);

      const response = await fetch(`${root}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': contentType,
          'x-upsert': 'true',
          'cache-control': 'max-age=3600',
        },
        body: new Uint8Array(bytes),
      });
      if (!response.ok) {
        throw new LogoStoreError(`Storage refused the upload (${response.status})`);
      }

      // A version query means a replaced logo is visible immediately even
      // behind a CDN.
      return `${root}/storage/v1/object/public/${BUCKET}/${path}?v=${Date.now()}`;
    },

    async remove(storeId) {
      // Remove every extension we might have written; ignore "not found".
      for (const extension of Object.values(EXTENSION)) {
        const response = await fetch(
          `${root}/storage/v1/object/${BUCKET}/${objectPath(storeId, extension)}`,
          { method: 'DELETE', headers },
        );
        if (!response.ok && response.status !== 404) {
          throw new LogoStoreError(`Storage refused the delete (${response.status})`);
        }
      }
    },
  };
}

/** The real type of an image, from its first bytes, not its label. */
export function sniffImageType(
  bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
