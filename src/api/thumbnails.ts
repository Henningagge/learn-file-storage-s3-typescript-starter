import { getBearerToken, validateJWT } from '../auth';
import { respondWithJSON } from './json';
import { getVideo, updateVideo } from '../db/videos';
import type { ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('Invalid video ID');
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const formData = await req.formData();
  let imageData = formData.get('thumbnail');
  const videoMetadata = getVideo(cfg.db, videoId);
  const MAX_UPLOAD_SIZE = 10 << 20;

  if (!(imageData instanceof File)) {
    throw new BadRequestError('Thumbnail file missing');
  }

  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Filesize is to Large for Upload');
  }

  const mediaType = imageData.type;
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') {
    throw new BadRequestError(
      'Wrong file format found. File is not a JPEG or PNG'
    );
  }

  if (!videoMetadata) {
    throw new NotFoundError('Metadata could no be found');
  }
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError('Wrong UserId for accessing videos');
  }
  const randomBytesString = randomBytes(32).toString('base64url');
  const filePath = path.join(cfg.assetsRoot, `${randomBytesString}`);

  videoMetadata.thumbnailURL = `http://localhost:${cfg.port}/assets/${randomBytesString}`;
  Bun.write(filePath, imageData);
  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
