#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the YAML file
const yamlContent = fs.readFileSync('./api/openapi.yaml', 'utf8');
const apiSpec = yaml.load(yamlContent);

// Base directory for controllers
const controllersDir = './src/controllers';

// Create directory if it doesn't exist
if (!fs.existsSync(controllersDir)) {
  fs.mkdirSync(controllersDir, { recursive: true });
}

// Store controller information
const controllers = new Map();

// Process paths
Object.entries(apiSpec.paths).forEach(([pathUrl, methods]) => {
  Object.entries(methods).forEach(([method, operation]) => {
    if (operation['x-eov-operation-handler'] && operation['x-eov-operation-id']) {
      const handlerName = operation['x-eov-operation-handler'];
      const operationId = operation['x-eov-operation-id'];

      if (!controllers.has(handlerName)) {
        controllers.set(handlerName, []);
      }

      controllers.get(handlerName).push({
        operationId,
        method: method.toUpperCase(),
        path: pathUrl,
        summary: operation.summary || '',
        description: operation.description || '',
      });
    }
  });
});

// Helper function to generate TypeScript type annotations
function generateTypeAnnotations(operationId) {
  return {
    operation: `operations['${operationId}']`,
    pathParams: `operations['${operationId}']['parameters']['path']`,
    queryParams: `operations['${operationId}']['parameters']['query']`,
    requestBody: `operations['${operationId}']['requestBody']['content']['application/json']`,
    responseBody: `operations['${operationId}']['responses'][200]['content']['application/json']`,
  };
}

// Generate controller files
controllers.forEach((operations, controllerName) => {
  const fileName = `${controllerName}.ts`;
  const filePath = path.join(controllersDir, fileName);

  // Check if file already exists
  if (fs.existsSync(filePath)) {
    console.log(`⚠️  ${fileName} already exists, skipping...`);
    return;
  }

  // Generate controller content
  let content = `/**
 * ${controllerName}
 * Auto-generated from OpenAPI specification
 */

import type { NextFunction } from 'express';

import type { ApiRequest, ApiResponse } from '../types/api-helpers';

`;

  operations.forEach((op) => {
    const types = generateTypeAnnotations(op.operationId);

    // Determine default response status code based on HTTP method
    let defaultStatusCode = 200;
    if (op.method === 'POST') defaultStatusCode = 201;
    if (op.method === 'DELETE') defaultStatusCode = 204;

    // Format the response type - include status code if not 200
    const responseType =
      defaultStatusCode === 200
        ? `ApiResponse<'${op.operationId}'>`
        : `ApiResponse<'${op.operationId}', ${defaultStatusCode}>`;

    // Generate response code based on status
    const responseCode =
      defaultStatusCode === 204
        ? `res.status(${defaultStatusCode}).end();`
        : `// TODO: Return properly typed response matching the schema
    throw new Error('${op.operationId} not implemented');`;

    content += `/**
 * ${op.summary}
 * ${op.description}
 * @route ${op.method} ${op.path}
 */
export const ${op.operationId} = async (
  req: ApiRequest<'${op.operationId}'>,
  res: ${responseType},
  next: NextFunction
): Promise<void> => {
  try {
    // TODO: Implement business logic
    // Type information:
    // - req.params: Typed path parameters
    // - req.query: Typed query parameters
    // - req.body: Typed request body

    ${responseCode}
  } catch (error) {
    next(error);
  }
};

`;
  });

  // Write file
  fs.writeFileSync(filePath, content);
  console.log(`✅ Generated: ${fileName}`);
  console.log(`   Operations: ${operations.map((o) => o.operationId).join(', ')}`);
});

console.log('\n🎉 Generation completed!');
