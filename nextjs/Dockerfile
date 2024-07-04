# AUTHOR NAUVAL YUSUF ADDAIRY https://github.com/nauvalyusufaddairy


# builder stage
FROM public.ecr.aws/docker/library/node:20.9.0-slim as builder
# working directory inside the container runtime
# you can create another working directory as per your requirements but if the directory is not provided by default
# like /app dir you must make that directory by typing RUN mkdir <YOUR PREFERED DIRECTORY>

WORKDIR /app
# copy all assets in current vscode folder to /app folder in container
COPY . .
# install all dependencies in container
RUN npm ci && npm run build

# runner stage for container
FROM public.ecr.aws/docker/library/node:20.9.0-slim as runner
# copy modified runtime for handle http request. see lambda layer term 
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.3 /lambda-adapter /opt/extensions/lambda-adapter
# assign known env variable related to aws lambda PORT for port in aws lambda and NODE_ENV is known env for nodejs
ENV PORT=3000 NODE_ENV=production
# assign knwon env variable related to aws lambda 
# this env enable aws lambda to to response gzip 
ENV AWS_LWA_ENABLE_COMPRESSION=true

# work directory in runner stage
WORKDIR /app
# copy specific assets from builder stage to runner stage
# you must know how nextjs app build/output
# in my case i just copy standalone folder for high performance app


COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next/standalone/ ./
COPY --from=builder /app/public ./public
# i highly recommended use CDN like aws cloudfront to serve static assets. and not put your assets in the container
# why i do this because my assets is less than 10 mb lambda function can tolerate that size
COPY --from=builder /app/.next/static ./.next/static


# run this command when container is running 
# server.js must placed in /app directory if not. something gone wrong at your build process 
# see at next.config.mjs make sure output:"standalone" at config property
CMD ["node","server.js"]