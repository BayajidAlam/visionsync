const AWS = require("aws-sdk");

const ecs = new AWS.ECS();
const s3 = new AWS.S3();
const sqs = new AWS.SQS();

exports.handler = async (event) => {
  try {
    const message = event.Records[0].body;
    const { bucketName, fileName } = JSON.parse(message);

    console.log(`Processing video: ${fileName} from bucket: ${bucketName}`);

    // Define ECS task parameters
    const params = {
      cluster: process.env.ECS_CLUSTER, // ECS Cluster name
      taskDefinition: process.env.ECS_TASK_DEFINITION, // ECS Task Definition ARN
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: [process.env.SUBNET_ID],
          securityGroups: [process.env.SECURITY_GROUP_ID],
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "video-processor", // Container name from ECS task definition
            environment: [
              { name: "VIDEO_BUCKET", value: bucketName },
              { name: "VIDEO_FILE_NAME", value: fileName },
              { name: "OUTPUT_BUCKET", value: process.env.PROCESSED_BUCKET },
            ],
          },
        ],
      },
    };

    // Run the ECS task
    const result = await ecs.runTask(params).promise();
    console.log("ECS Task Started:", result);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "ECS task triggered", result }),
    };
  } catch (error) {
    console.error("Error triggering ECS task:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Failed to trigger ECS task", error }),
    };
  }
};
