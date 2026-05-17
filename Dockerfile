FROM node:20-alpine

# Install build dependencies that might be needed by some node packages
RUN apk add --no-cache python3 make g++ 

WORKDIR /app

# Copy root files
COPY . .

# Build Frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Build Backend
WORKDIR /app/backend
RUN npm install
RUN npm run build

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
