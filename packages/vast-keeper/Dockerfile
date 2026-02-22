# Use a lightweight Node image as base
FROM node:22-bullseye-slim

# Install system dependencies (Python for vastai CLI, git, ssh)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    openssh-client \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun for execution
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install the Vast API Client
RUN pip3 install --no-cache-dir vastai-sdk

# Set up work directory
WORKDIR /app

# Copy over package files
COPY package.json ./

# Install project dependencies
RUN bun install

# Copy source
COPY src/ ./src/

# Run the keeper watchdog
CMD ["bun", "run", "start"]
