import { getBearerToken, validateJWT } from '../auth';
import { respondWithJSON } from './json';
import { getVideo, updateVideo } from '../db/videos';
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
    throw new BadRequestError('Thumbnail file missing');
  }
  const MAX_UPLOAD_SIZE = 10 << 20;
  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError('Filesize is to Large for Upload');
  }
  const mediaType = imageData.type;
  const buffer = await imageData.arrayBuffer();
  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError('Metadata could no be found');
  }
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError('Wrong UserId for accessing videos');
  }

  const thumb: Thumbnail = {
    data: buffer,
    mediaType: mediaType,
  };
  videoThumbnails.set(videoId, thumb);
  const thumbURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;
  videoMetadata.thumbnailURL = thumbURL;
  const updatedVideo = await updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, updatedVideo);
}
