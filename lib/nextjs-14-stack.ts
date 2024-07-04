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

// VERSI INI TANPA PAKE CDN LIHAT BRANCH "MAIN" KLO MAU PAKE CDN. CEK JUGA DOCKERFILE NYA SOALNYA SALING BERKAITAN

/**
 *  DOKUMENTASI INI DI BUAT  UNTUK DEVELOPER LAINNYA AGAR DAPAT MEMAHAMI DENGAN MUDAH APA YANG SAYA DEVELOP
 *  SENGAJA MENGGUNAKAN BAHASA SEHARI-HARI AGAR TIDAK MONOTON :D :D
 *
 *  LIHAT JUGA DOCKERFILE NYA YA GUYS BIAR LEBIH RELEVAN
 */

export class Nextjs14Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // get image from ecr repo
    // 162199820031.dkr.ecr.ap-southeast-1.amazonaws.com/lambda-nextjs:no-cdn
    const repo = ecr.Repository.fromRepositoryArn(
      this,
      "the-repo",
      // ini wajib di simpen di env klo gak ya kena hack
      // kenapa saya engga? karena saya tau apa yg saya lakukan hehe
      "arn:aws:ecr:ap-southeast-1:162199820031:repository/lambda-nextjs"
    );

    // create lambda function to host nextjs app
    const nextCdkFunction = new lambda.Function(this, "NextCdkFunction", {
      // the runtime sama dengan yang di dockerfile
      runtime: lambda.Runtime.FROM_IMAGE,
      // handler server.js ==> CMD ["node","server.js"]
      handler: lambda.Handler.FROM_IMAGE,
      // code nya ngambil dari ecr ya guys
      code: lambda.Code.fromEcrImage(repo, {
        tagOrDigest: "no-cdn",
      }),
      // sangat di rekomendasikan pake amd64/x86 kenapa? so far gak ada error sih
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

    // api.roor.addMethod() maksudnya root disini hostname kita misal https://aduh.com/ ini root endpoint ya guys
    api.root.addMethod("ANY", nextCdkFunctionIntegration);
    // api.root.addProxy() ini tuh maksudnya agar si root endpoint kita bisa handle dynamic routing https://aduh.com/blabla/blabal/**// */
    api.root.addProxy({
      defaultIntegration: new apiGateway.LambdaIntegration(nextCdkFunction, {
        allowTestInvoke: false,
      }),
      anyMethod: true,
    });

    /**
     *  CDN SECTION
     */

    // BUCKET ITU STORAGE in general

    // bucket dibawah ini buat nyimpen log kali aja ada anak soc mau ngurusin security nah kasih log ini ke dia
    const nextLoggingBucket = new s3.Bucket(this, "next-logging-bucket", {
      // jadi hanya untuk private. public no access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
    });

    // kalo bucket ini beda ya guys inimah untuk nyimpen static assets yang ada di folder .next/static klo asset kita sizenya > 10mb
    // kalo aplikasi nya masih kecil mending gak usah bikin bucket ini
    // klo aplikasi kita masih imut < 10mb lu bisa ikutin saran dibawah ini
    // copy folder .next/static dan public ke folder standalone pas udah di build ya guys
    /**
     * Biar apa sih? ya biar asset aplikasi yang saudara buat tidak nambah-nambah beban si lambdanya semakin imut build sizenya
     * semakin kenceng aplikasi yang saudara buat gitu sih simplenya.
     * ya klo saudara gak mau ribet dan cukup kaya bisa sewa dedicated server dan gak usah deploy ke serverless hehe
     */
    const nextBucket = new s3.Bucket(this, "next-bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      serverAccessLogsBucket: nextLoggingBucket,
      serverAccessLogsPrefix: "s3-access-logs",
    });

    new CfnOutput(this, "Next bucket", { value: nextBucket.bucketName });

    // nah ini untuk mendistribusikan static asset kita ya guys kita pake teknologi CDN

    const cloudfrontDistribution = new cloudfront.Distribution(
      this,
      "Distribution",
      {
        defaultBehavior: {
          // ORIGIN itu dari mana api call di inisiasi dalam kasus ini dari api gateway kita ya guys.
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy:
            // nah ini penyebab munculnya code 302
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // cache di disable biar lebih murah, tapi lebih bagus di enable aja klo anda anaknya raja salman
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        // lihat bundled app kita ya guyS
        // ketika aplikasi kita di akses server ngirim asset berupa javascript, css, html dll
        // semua file di atas di simpan di folder tertentu tiap versi nextjs mungkin memiliki penamaan folder yang berbeda
        // nah klo next 12.4.2 folder dibawah ini yang muncul
        /**
         * 1. _next/static
         * 2. static/
         *
         * kenapa gak pake wildcard (*) error euy jadi pas di develop anda harus tau folder apa aja yg di kirim oleh server
         *
         * cara cari tau nya klik kanan di page aplikasi anda lalu pilih inspect lalu klik sources nah disitu folder yang dikirim oleh server ke client kita
         * umum nya folder itu akan konsisten setelah di deploy kecuali anda mengubah kodingan  maka anda harus deploy ulang dan cari tahu lagi foldernya OKE :)
         *
         */
        additionalBehaviors: {
          // karena gak bisa pake wildcards jadi urang tulis satu" folder dan anak-anak nya :(:(
          // tapi saya tetep ada yg pake wildcards kali aja bugs ini ada yang benerin di masa depan hehe

          // ini pake wildcards atau asterisk kata anak python mah
          "_next/static/*": {
            origin: new origins.S3Origin(nextBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          },
          // ini kagak pake
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

    // buat nampilin url dari cloudfront di console pas deploy cdk
    new CfnOutput(this, "CloudFront URL", {
      value: `https://${cloudfrontDistribution.distributionDomainName}`,
    });

    // nahh ini deploy static asset kita
    new s3deploy.BucketDeployment(this, "deploy-next-static-bucket", {
      // posisi static asset kita di vscode
      sources: [s3deploy.Source.asset("nextjs/.next/static/")],
      destinationBucket: nextBucket,
      // posisi static asset kita di server
      destinationKeyPrefix: "_next/static",
      distribution: cloudfrontDistribution,
      // ini endpoint nya klo yg ini bisa pake wildcard gak tau kenapa mungkin saya akan rise issue di github official nya :)
      distributionPaths: ["/_next/static/*"],
    });

    new s3deploy.BucketDeployment(this, "deploy-next-public-bucket", {
      // posisi public static asset kita di vscode
      sources: [s3deploy.Source.asset("nextjs/public/static/")],
      destinationBucket: nextBucket,
      destinationKeyPrefix: "static",
      distribution: cloudfrontDistribution,
      // ini endpoint nya
      distributionPaths: ["/static/*"],
    });
  }
}
