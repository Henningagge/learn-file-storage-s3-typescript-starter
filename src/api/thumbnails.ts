import { getBearerToken, validateJWT } from '../auth';
import { respondWithJSON } from './json';
import { getVideo, updateVideo } from '../db/videos';
import type { ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';
import { Buffer } from 'node:buffer';

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('Invalid video ID');
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log('uploading thumbnail for video', videoId, 'by user', userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  let imageData = formData.get('thumbnail');
  if (!(imageData instanceof File)) {
    throw new BadRequestError('Thumbnail file missing');
  }
  const MAX_UPLOAD_SIZE = 10 << 20;
  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Filesize is to Large for Upload');
  }
  const mediaType = imageData.type;
  const arrayBuffer = await imageData.arrayBuffer();
  const buffer: Buffer = Buffer.from(arrayBuffer);
  let bufferString = buffer.toString('base64');
  const dataUrl = `data:${mediaType};base64,${bufferString}`;
  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError('Metadata could no be found');
  }
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError('Wrong UserId for accessing videos');
  }
  console.log(dataUrl);
  videoMetadata.thumbnailURL = dataUrl;
  const updatedVideo = await updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, updatedVideo);
}
