const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const VERSION = process.env.RELEASE_VERSION;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;

async function fetchExistingReleases() {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: 'releases.json',
    }));
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.log('No existing releases.json found, creating new one');
      return { latestVersion: null, releases: [] };
    }
    throw error;
  }
}

async function uploadFile(localPath, r2Key, contentType) {
  const fileBuffer = fs.readFileSync(localPath);
  const stats = fs.statSync(localPath);

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: r2Key,
    Body: fileBuffer,
    ContentType: contentType,
  }));

  console.log(`Uploaded: ${r2Key} (${stats.size} bytes)`);
  return stats.size;
}

function findArtifacts(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  return files.filter(f => pattern.test(f)).map(f => path.join(dir, f));
}

async function main() {
  const artifactsDir = 'artifacts';

  // Find all artifacts
  const artifacts = {
    windows: findArtifacts(
      path.join(artifactsDir, 'windows-builds'),
      /\.exe$/
    ),
    macos: findArtifacts(
      path.join(artifactsDir, 'macos-builds'),
      /-x64\.dmg$/
    ),
    macosArm: findArtifacts(
      path.join(artifactsDir, 'macos-builds'),
      /-arm64\.dmg$/
    ),
    linux: findArtifacts(
      path.join(artifactsDir, 'linux-builds'),
      /\.AppImage$/
    ),
  };

  console.log('Found artifacts:');
  for (const [platform, files] of Object.entries(artifacts)) {
    console.log(`  ${platform}: ${files.length > 0 ? files.map(f => path.basename(f)).join(', ') : 'none'}`);
  }

  // Upload each artifact to R2
  const assets = {};
  const contentTypes = {
    windows: 'application/x-msdownload',
    macos: 'application/x-apple-diskimage',
    macosArm: 'application/x-apple-diskimage',
    linux: 'application/x-executable',
  };

  for (const [platform, files] of Object.entries(artifacts)) {
    if (files.length === 0) {
      console.warn(`Warning: No artifact found for ${platform}`);
      continue;
    }

    // Use the first matching file for each platform
    const localPath = files[0];
    const filename = path.basename(localPath);
    const r2Key = `releases/${VERSION}/${filename}`;
    const size = await uploadFile(localPath, r2Key, contentTypes[platform]);

    assets[platform] = {
      url: `${PUBLIC_URL}/releases/${VERSION}/${filename}`,
      filename,
      size,
      arch: platform === 'macosArm' ? 'arm64' : 'x64',
    };
  }

  // Fetch and update releases.json
  const releasesData = await fetchExistingReleases();

  const newRelease = {
    version: VERSION,
    date: new Date().toISOString(),
    assets,
    githubReleaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${VERSION}`,
  };

  // Remove existing entry for this version if re-running
  releasesData.releases = releasesData.releases.filter(r => r.version !== VERSION);

  // Prepend new release
  releasesData.releases.unshift(newRelease);
  releasesData.latestVersion = VERSION;

  // Upload updated releases.json
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'releases.json',
    Body: JSON.stringify(releasesData, null, 2),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=60',
  }));

  console.log('Successfully updated releases.json');
  console.log(`Latest version: ${VERSION}`);
  console.log(`Total releases: ${releasesData.releases.length}`);
}

main().catch(err => {
  console.error('Failed to upload to R2:', err);
  process.exit(1);
});
