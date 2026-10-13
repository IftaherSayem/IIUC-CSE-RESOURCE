# Use lightweight Node.js 20 Alpine Linux image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package manifest and server code
COPY package.json ./
COPY server.js ./

# Create data directory for subscribers & config
RUN mkdir -p data

# Expose default application port
EXPOSE 5000

# Set default port environment variable
ENV PORT=5000

# Start server
CMD ["node", "server.js"]
