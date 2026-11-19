import { Directory, File, Paths } from 'expo-file-system';
import type { LocalPhoto, PhotoStore } from './types';

// Image picker results live in the cache directory, which the OS may purge at any time.
// A queued submission could sit for hours on bad wifi, so copy its photos into documents first.
const dirFor = (itemId: string) => new Directory(Paths.document, 'outbox', itemId);

export const fileSystemPhotoStore: PhotoStore = {
  async persist(itemId, photos) {
    const dir = dirFor(itemId);
    dir.create({ intermediates: true, idempotent: true });
    return Promise.all(
      photos.map(async (photo, index): Promise<LocalPhoto> => {
        const ext = photo.name.includes('.') ? photo.name.split('.').pop() : 'jpg';
        const dest = new File(dir, `${index}.${ext}`);
        await new File(photo.uri).copy(dest);
        return { ...photo, uri: dest.uri };
      }),
    );
  },
  async remove(itemId) {
    const dir = dirFor(itemId);
    if (dir.exists) dir.delete();
  },
};
