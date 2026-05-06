# Multi-stage build for React frontend
FROM node:18-alpine AS builder

# Accept API URL and CloudFront domain as build arguments
ARG VITE_API_URL=http://localhost:5000
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_CLOUDFRONT_URL=
ENV VITE_CLOUDFRONT_URL=$VITE_CLOUDFRONT_URL

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx configuration (serves SPA, all API calls go via browser to ALB)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]