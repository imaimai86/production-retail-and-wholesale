const express = require('express');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.SWAGGER_PORT || 3001; // Use SWAGGER_PORT or default to 3001
const specPath = path.join(__dirname, 'openapi-spec.json'); // Updated path to openapi-spec.json in server directory

let swaggerDocument;
try {
  swaggerDocument = JSON.parse(fs.readFileSync(specPath, 'utf8'));
} catch (err) {
  console.error('Failed to load or parse openapi-spec.json:', err);
  console.error(`Please ensure 'server/openapi-spec.json' exists and is valid. You might need to run 'npm run generate-spec'.`);
  process.exit(1);
}

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.listen(port, () => {
  console.log(`Swagger UI server listening on port ${port}, serving /docs`);
  console.log(`Using spec from: ${specPath}`);
  console.log(`Open http://localhost:${port}/docs in your browser to view the API documentation`);
}); 