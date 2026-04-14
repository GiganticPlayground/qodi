#!/bin/bash

# Qodi Setup Script
# This script automates the complete setup process from OpenAPI spec to running Docker container

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored messages
print_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

print_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

print_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  ${1}${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""
}

# Check if OpenAPI spec exists
print_header "Qodi Setup"

if [ ! -f "api/openapi.yaml" ]; then
    print_error "OpenAPI specification not found!"
    echo ""
    echo "Please add your OpenAPI specification file to: api/openapi.yaml"
    echo ""
    echo "Example:"
    echo "  cp your-api-spec.yaml api/openapi.yaml"
    echo ""
    exit 1
fi

print_success "Found OpenAPI specification: api/openapi.yaml"
echo ""

# Step 1: Generate TypeScript Types
print_header "Step 1: Generating TypeScript Types"
print_info "Running: npm run gen-types"
npm run gen-types
print_success "TypeScript types generated successfully"
echo ""

# Step 2: Generate Controller Scaffolds
print_header "Step 2: Generating Controller Scaffolds"
print_info "Running: npm run gen-controllers"
npm run gen-controllers
print_success "Controllers generated successfully"
echo ""

# Step 3: Build Docker Image
print_header "Step 3: Building Docker Image"
print_info "Building Docker image (TypeScript runs directly with tsx)"
docker compose build
print_success "Docker image built successfully"
echo ""

# Step 4: Start Docker Container
print_header "Step 4: Starting Docker Container"
print_info "Running: docker compose up -d"
docker compose up -d
print_success "Docker container started successfully"
echo ""

# Wait a moment for container to be ready
print_info "Waiting for container to be ready..."
sleep 3

# Final success message
print_header "Setup Complete!"
echo ""
echo -e "${GREEN}Your API is now running!${NC}"
echo ""
echo "Access your API at:"
echo -e "  ${BLUE}API Endpoint:${NC}  http://localhost:8080"
echo -e "  ${BLUE}Swagger UI:${NC}    http://localhost:8080/api-docs"
echo -e "  ${BLUE}Health Check:${NC}  http://localhost:8080/health"
echo ""
echo "Useful commands:"
echo -e "  ${YELLOW}npm run docker:logs${NC}  - View container logs"
echo -e "  ${YELLOW}npm run docker:down${NC}  - Stop the container"
echo -e "  ${YELLOW}npm run dev${NC}          - Run in development mode"
echo ""
print_success "Happy coding!"
echo ""
