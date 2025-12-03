import { respondWithJSON } from './json';
import { updateVideo } from '../db/videos';
import { type ApiConfig } from '../config';
import { file, S3Client, type BunRequest } from 'bun';
import { BadRequestError, UserForbiddenError } from './errors';
import { getBearerToken, validateJWT } from '../auth';
import { getVideo } from '../db/videos';
import { randomBytes } from 'crypto';
import { rm } from 'fs/promises';
import path from 'path';
import type { Video } from '../db/videos';
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
  let aspectration = await getVideoAspectRatio(filePath);

  const processedOutputPath = await processVideoForFastStart(filePath);
  const s3RandomBytesString = randomBytes(32).toString('hex');
  const s3key = `${aspectration}${s3RandomBytesString}.mp4`;

  const tempFile = Bun.file(processedOutputPath);
  const s3File = cfg.s3Client.file(s3key, { bucket: cfg.s3Bucket });
  await s3File.write(tempFile, { type: 'video/mp4' });
  videoMetadata.videoURL = `${s3key}`;

  await rm(filePath, { force: true });
  await rm(processedOutputPath, { force: true });

  updateVideo(cfg.db, videoMetadata);
  const videoMetadataSigned = await dbVideoToSignedVideo(cfg, videoMetadata);
  return respondWithJSON(200, videoMetadataSigned);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(
    [
      'ffprobe',
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      filePath,
    ],
    { stderr: 'pipe', stdout: 'pipe' }
  );

  if (!proc) {
    throw new BadRequestError('proc coult not be gathered');
  }
  if (!proc.stderr) {
    throw new BadRequestError('proc is undifined in stderr');
  }
  if (!proc.stdout) {
    throw new BadRequestError('proc is undifined in stdout');
  }

  const outOutput = await new Response(proc.stdout).text();
  const errOutput = await new Response(proc.stderr).text();
  const exited = await proc.exited;
  if (exited !== 0) {
    throw new BadRequestError('the proc exited with error code uneaqual to 0');
  }
  let meta = JSON.parse(outOutput);
  const width = meta.streams[0].width;
  const height = meta.streams[0].height;
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.1) {
    return 'landscape/';
  } else if (Math.abs(ratio - 9 / 16) < 0.1) {
    return 'portrait/';
  } else {
    return 'other/';
  }
}

export async function processVideoForFastStart(inputFilePath: string) {
  let outputPath = inputFilePath + '.processed';
  let proc = Bun.spawn(
    [
      'ffmpeg',
      '-i',
      inputFilePath,
      '-movflags',
      'faststart',
      '-map_metadata',
      '0',
      '-codec',
      'copy',
      '-f',
      'mp4',
      outputPath,
    ],
    { stderr: 'pipe', stdout: 'pipe' }
  );
  const exited = await proc.exited;
  if (exited !== 0) {
    throw new BadRequestError('the proc exited with error code uneaqual to 0');
  }
  return outputPath;
}

export async function generatePresignedURL(
  cfg: ApiConfig,
  key: string,
  expireTime: number
) {
  const signedURL = cfg.s3Client.presign(`${key}`, {
    expiresIn: expireTime,
  });
  return signedURL;
}
export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  const key = video.videoURL;
  if (!key) {
    return video;
  }
  const preSignedUrl = await generatePresignedURL(cfg, key, 360);
  video.videoURL = preSignedUrl;

  return video;
}
