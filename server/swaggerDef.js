const path = require('path');

module.exports = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Server API',
      version: '1.0.0',
      description: 'API documentation for the server',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
      },
    ],
    components: {
      securitySchemes: {
        xAuthToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-auth-token',
        },
      },
    },
    security: [
      {
        xAuthToken: [],
      },
    ],
  },
  apis: [path.join(__dirname, './index.js')], // Path to the API routes file
};
