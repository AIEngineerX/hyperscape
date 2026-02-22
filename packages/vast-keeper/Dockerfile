# Use a Node image with Python 3.11+ (bookworm = Debian 12, has Python 3.11)
FROM node:22-bookworm-slim

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
ENV PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Install the Vast API Client (--break-system-packages needed for Debian 12 PEP 668)
RUN pip3 install --no-cache-dir --break-system-packages vastai-sdk \
    && python3 -c "import vastai; print('vastai module OK')"

# Symlink the vastai binary if pip created one
RUN ln -sf $(python3 -c "import shutil; print(shutil.which('vastai') or '')") /usr/local/bin/vastai 2>/dev/null || true

# Generate SSH key for Vast.ai SSH connections
RUN mkdir -p /root/.ssh && ssh-keygen -t rsa -b 4096 -f /root/.ssh/id_rsa -N "" -q

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

