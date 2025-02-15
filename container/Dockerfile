FROM jrottenberg/ffmpeg:latest

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy application files
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Start the application
ENTRYPOINT ["node", "process-video.js"]
