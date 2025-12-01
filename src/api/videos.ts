import { respondWithJSON } from './json';
import { updateVideo } from '../db/videos';
import { type ApiConfig } from '../config';
import { S3Client, type BunRequest } from 'bun';
import { BadRequestError, UserForbiddenError } from './errors';
import { getBearerToken, validateJWT } from '../auth';
import { getVideo } from '../db/videos';
import { randomBytes } from 'crypto';
import { rm } from 'fs/promises';
import path from 'path';
export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const uploadLimit = 1 << 30;
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError('The Video ID could not be extracted');
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  let videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError(
      'The Userid of the Video is different the the accesing user id'
    );
  }
  const formData = await req.formData();
  const videoData = formData.get('video');
  if (!(videoData instanceof File)) {
    throw new BadRequestError('Video file missing');
  }
  if (videoData?.size > uploadLimit) {
    throw new BadRequestError('The file was to big to upload');
  }
  const videoType = videoData.type;
  if (videoType !== 'video/mp4') {
    throw new BadRequestError('The video is not of type mp4');
  }
  const randomBytesString = randomBytes(32).toString('base64url');
  const filePath = path.join(cfg.assetsRoot, `${randomBytesString}`);
  await Bun.write(filePath, videoData);
  const s3RandomBytesString = randomBytes(32).toString('hex');
  const s3key = `${s3RandomBytesString}.mp4`;
  try {
    const tempFile = Bun.file(filePath);
    const s3File = cfg.s3Client.file(s3key);
    await s3File.write(tempFile, { type: 'video/mp4' });
    videoMetadata.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3key}`;
  } finally {
    await rm(filePath, { force: true });
  }
  updateVideo(cfg.db, videoMetadata);
  return respondWithJSON(200, videoMetadata);
}
