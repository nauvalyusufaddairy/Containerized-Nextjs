import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import * as apiGateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ecr from "aws-cdk-lib/aws-ecr";

const path = require("node:path");

export class Nextjs14Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // get image from ecr repo
    const repo = ecr.Repository.fromRepositoryArn(
      this,
      "the-repo",
      "arn:aws:ecr:ap-southeast-1:162199820031:repository/lambda-nextjs"
    );

    // create lambda function to host nextjs app
    const nextCdkFunction = new lambda.Function(this, "NextCdkFunction", {
      // the runtime sama dengan yang di dockerfile
      runtime: lambda.Runtime.FROM_IMAGE,
      // handler server.js ==> CMD ["node","server.js"]
      handler: lambda.Handler.FROM_IMAGE,
      // code nya ngambil dari ecr ya bosss
      code: lambda.Code.fromEcrImage(repo),
      // sangat di rekomendasikan pake amd64/x86 kenapa so far gak ada error sih
      architecture: lambda.Architecture.X86_64,
    });

    // bikin rest api buat handle request dari client
    const api = new apiGateway.RestApi(this, "api", {
      defaultCorsPreflightOptions: {
        allowOrigins: apiGateway.Cors.ALL_ORIGINS,
        allowMethods: apiGateway.Cors.ALL_METHODS,
      },
    });

    // bikin integrasi antara rest api dengan si aws lambda-nya
    const nextCdkFunctionIntegration = new apiGateway.LambdaIntegration(
      nextCdkFunction,
      {
        allowTestInvoke: false,
      }
    );

    // api.roor.addMethod() maksudnya root disini hostname kita misal https://aduh.com/ ini root endpoint ya
    api.root.addMethod("ANY", nextCdkFunctionIntegration);
    // api.root.addProxy() ini tuh maksudnya agar si root endpoint kita bisa handle dynamic routing https://aduh.com/blabla/blabal/**// */
    api.root.addProxy({
      defaultIntegration: new apiGateway.LambdaIntegration(nextCdkFunction, {
        allowTestInvoke: false,
      }),
      anyMethod: true,
    });

    const nextLoggingBucket = new s3.Bucket(this, "next-logging-bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
    });

    const nextBucket = new s3.Bucket(this, "next-bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      serverAccessLogsBucket: nextLoggingBucket,
      serverAccessLogsPrefix: "s3-access-logs",
    });

    new CfnOutput(this, "Next bucket", { value: nextBucket.bucketName });

    const cloudfrontDistribution = new cloudfront.Distribution(
      this,
      "Distribution",
      {
        defaultBehavior: {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        additionalBehaviors: {
          "_next/static/*": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
          "_next/static/chunks": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
          "_next/static/media": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
          "_next/static/webpack": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
          "static/*": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
        },
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2018,
        logBucket: nextLoggingBucket,
        logFilePrefix: "cloudfront-access-logs",
      }
    );

    new CfnOutput(this, "CloudFront URL", {
      value: `https://${cloudfrontDistribution.distributionDomainName}`,
    });

    new s3deploy.BucketDeployment(this, "deploy-next-static-bucket", {
      sources: [s3deploy.Source.asset("nextjs/.next/static/")],
      destinationBucket: nextBucket,
      destinationKeyPrefix: "_next/static",
      distribution: cloudfrontDistribution,
      distributionPaths: ["/_next/static/*"],
    });

    new s3deploy.BucketDeployment(this, "deploy-next-public-bucket", {
      sources: [s3deploy.Source.asset("nextjs/public/static/")],
      destinationBucket: nextBucket,
      destinationKeyPrefix: "static",
      distribution: cloudfrontDistribution,
      distributionPaths: ["/static/*"],
    });
  }
}
