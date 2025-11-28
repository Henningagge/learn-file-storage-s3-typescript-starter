import { getBearerToken, validateJWT } from '../auth';
import { respondWithJSON } from './json';
import { getVideo } from '../db/videos';
import type { ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('Invalid video ID');
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError('Thumbnail not found');
  }

  return new Response(thumbnail.data, {
    headers: {
      'Content-Type': thumbnail.mediaType,
      'Cache-Control': 'no-store',
    },
  });
}

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
    throw new BadRequestError('Thumbnail is missing');
  }
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('filesize to big');
  }
  const mediaType = imageData.type;
  const buffer = await imageData.arrayBuffer();
  const videoMetadata = await getVideo(cfg.db, videoId);
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError('This is not youre video');
  }
  return respondWithJSON(200, null);
}
