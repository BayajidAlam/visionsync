const AWS = require('aws-sdk');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

const s3 = new AWS.S3();
const TEMP_DIR = '/tmp/video-processing';

async function processVideo(inputBucket, inputKey, outputBucket) {
    try {
        console.log(`Processing video: ${inputKey} from bucket: ${inputBucket}`);
        
        // Ensure temporary directories exist
        await fs.mkdir(TEMP_DIR, { recursive: true });
        const inputPath = path.join(TEMP_DIR, 'input.mp4');
        const outputPath = path.join(TEMP_DIR, 'output');
        await fs.mkdir(outputPath, { recursive: true });

        // Download the video from S3
        const videoObject = await s3.getObject({ Bucket: inputBucket, Key: inputKey }).promise();
        await fs.writeFile(inputPath, videoObject.Body);

        // FFmpeg Command for DASH Processing
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-filter_complex',
                '[0:v]split=4[v1][v2][v3][v4]; \
                [v1]scale=1920:1080[v1out]; \
                [v2]scale=1280:720[v2out]; \
                [v3]scale=854:480[v3out]; \
                [v4]scale=640:360[v4out]',
                
                '-map', '[v1out]', '-c:v:0', 'libx264', '-b:v:0', '5000k',
                '-map', '[v2out]', '-c:v:1', 'libx264', '-b:v:1', '3000k',
                '-map', '[v3out]', '-c:v:2', 'libx264', '-b:v:2', '1500k',
                '-map', '[v4out]', '-c:v:3', 'libx264', '-b:v:3', '800k',

                '-map', '0:a?', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
                
                '-g', '48', '-sc_threshold', '0',
                '-keyint_min', '48', '-preset', 'fast',
                '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
                
                '-f', 'dash',
                '-seg_duration', '4',
                '-frag_duration', '4',
                '-min_seg_duration', '4',
                '-use_template', '1',
                '-use_timeline', '1',
                '-init_seg_name', 'init-$RepresentationID$.m4s',
                '-media_seg_name', 'chunk-$RepresentationID$-$Number$.m4s',
                path.join(outputPath, 'manifest.mpd')
            ]);

            ffmpeg.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
            ffmpeg.on('error', reject);
            ffmpeg.on('close', resolve);
        });

        // Upload processed files in parallel
        const files = await fs.readdir(outputPath);
        await Promise.all(files.map(async (file) => {
            const filePath = path.join(outputPath, file);
            await s3.upload({
                Bucket: outputBucket,
                Key: `${path.parse(inputKey).name}/${file}`,
                Body: await fs.readFile(filePath),
                ContentType: file.endsWith('.mpd') ? 'application/dash+xml' : 
                            file.endsWith('.m4s') ? 'video/iso.segment' : 
                            'application/octet-stream'
            }).promise();
        }));

        // Cleanup temp files
        await fs.rm(TEMP_DIR, { recursive: true, force: true });

        return {
            status: 'success',
            manifestUrl: `${path.parse(inputKey).name}/manifest.mpd`
        };
    } catch (error) {
        console.error('Error processing video:', error);
        throw error;
    }
}

// AWS Lambda Handler
exports.handler = async (event) => {
    try {
        const { VIDEO_BUCKET, VIDEO_FILE_NAME, OUTPUT_BUCKET } = process.env;
        const result = await processVideo(VIDEO_BUCKET, VIDEO_FILE_NAME, OUTPUT_BUCKET);
        return { statusCode: 200, body: JSON.stringify(result) };
    } catch (error) {
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
