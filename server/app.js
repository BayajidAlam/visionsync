import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";
import cors from "cors"; 

dotenv.config();

const app = express();
app.use(express.json());

app.use(cors());

const s3Client = new S3Client({
  region: "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

app.post("/upload/generate-presigned-url", async (req, res) => {
  const { fileName, fileType } = req.body;

  const videoId = `videos/${Date.now()}_${fileName}`;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME, 
    Key: videoId,
    ContentType: fileType,
  });

  try {
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });
    res.json({ presignedUrl, videoId });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});

app.listen(5000, () => {
  console.log("Server is running on http://localhost:5000");
});
