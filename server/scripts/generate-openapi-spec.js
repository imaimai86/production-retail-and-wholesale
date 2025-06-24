const fs = require('fs-extra');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerDefinition = require('../swaggerDef'); // Assuming swaggerDef.js is in server/

// Ensure NODE_ENV is set, defaulting to 'development' if not,
// as swaggerDef.js might use process.env.PORT
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const options = {
  ...swaggerDefinition, // Spread the existing definition
  apis: swaggerDefinition.apis.map(apiPath => path.resolve(__dirname, '..', apiPath)) // Ensure paths are absolute for swaggerJsdoc
};

const openapiSpecification = swaggerJsdoc(options);

const specPath = path.resolve(__dirname, '../../tools/openapi-spec.json'); // Path to tools/openapi-spec.json from server/scripts/

try {
  fs.ensureDirSync(path.dirname(specPath)); // Ensure 'tools' directory exists
  fs.writeFileSync(specPath, JSON.stringify(openapiSpecification, null, 2));
  console.log(`OpenAPI specification written to ${specPath}`);
} catch (err) {
  console.error('Error writing OpenAPI specification:', err);
  process.exit(1);
}
